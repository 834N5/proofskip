const ERROR_PAGE = browser.runtime.getURL("error.html");
const PPURLS = /^(?:https?:\/\/)?urldefense(?:\.proofpoint)?\.com\/.*/;
const PPURLPATTERNS =
	["*://urldefense.com/v*",
	"*://urldefense.proofpoint.com/v*"];

// made because clipboard API doesn't work in a background script in chromium
function clipboard(text) {
	browser.tabs.executeScript({
		code: `navigator.clipboard.writeText("${text}")`,
	});
}

function verifyUrl(url) {
	try {
		new URL(url);
		return true;
	} catch (_) {
		return false;
	}
}

function getErrorPage(req, error) {
	if (error) {
		return `${ERROR_PAGE}?u=${req}`;
	}
	return req;
}

function decryptBase64(base64) {
	base64 = atob(base64);
	base64 = Uint8Array.from(base64, (m) => m.codePointAt(0));
	return(new TextDecoder().decode(base64));
}

function decodeV1(req, error) {
	let redirect = new URL(req).searchParams.get("u");
	if (!redirect) {
		if (error) {
			return `${ERROR_PAGE}?u=${req}`;
		}
		return req;
	}
	redirect = decodeURIComponent(redirect);
	if (verifyUrl(redirect))
		return he.decode(redirect);
	return getErrorPage(req, error);
}

function decodeV2(req, error) {
	let redirect = new URL(req).searchParams.get("u");
	if (!redirect) {
		if (error) {
			return `${ERROR_PAGE}?u=${req}`;
		}
		return req;
	}
	redirect = redirect.replace(/-/g, "%").replace(/_/g, "/");
	redirect = decodeURIComponent(redirect);
	if (verifyUrl(redirect))
		return he.decode(redirect);
	return getErrorPage(req, error);
}

// TODO rename function to regexHell
/* proofpoint V3 is explained well here
 * https://github.com/cardi/proofpoint-url-decoder/blob/main/decode.py
 */
function decodeV3(req, error) {
	const REPLACEMENT_MAPPING_NUM= new Map();
	let repStr =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
		"abcdefghijklmnopqrstuvwxyz" +
		"0123456789-_";
	for (let i = 0; i < repStr.length; ++i) {
		REPLACEMENT_MAPPING_NUM.set(repStr[i], i+2);
	}

	let redirect = req.match(/^.+?__(.+)__;.*$/);
	let base64 = req.match(/^.+;(.*)!!.*$/);
	// CHECKPOINT: double check regex
	if (!redirect && !base64) {
		return `${ERROR_PAGE}?u=${req}`;
	}
	if (base64 == "") {
		return redirect[1];
	}
	let url = "";
	redirect = redirect[1];
	base64 = decryptBase64(base64[1]);
	for (let i = 0, tmpReplace; i < base64.length;) {
		if (tmpReplace = redirect.match(/^[^\*]*\*\*(.+?)/)) {
			// tmpReplace is the char for REPLACEMENT_MAPPING_NUM
			tmpReplace = tmpReplace[1];
			// url += stuff before **
			// url += replacement
			// redirect = stuff after **
			url += redirect.match(/^([^\*]*)\*\*/)[1];
			url += base64.substring(i,
				i+REPLACEMENT_MAPPING_NUM.get(tmpReplace));
			i += REPLACEMENT_MAPPING_NUM.get(tmpReplace);
			redirect = redirect.match(/^[^\*]*\*\*(.*)/)[1];
		} else if (tmpReplace = redirect.match(/^([^\*]*)\*(.*)/)) {
			// url += stuff before * + replacement
			// redirect = stuff after *
			url += tmpReplace[1] + base64[i++];
			redirect = tmpReplace[2];
		} else {
			return getErrorPage(req, error);
		}
	}
	if (redirect.includes("*"))
		return getErrorPage(req, error);
	url += redirect;
	// idk if this is needed
	//url = decodeURIComponent(url);
	if (verifyUrl(url))
		return url;
	return getErrorPage(req, error);
}

function decode(req, error=1) {
	// Allow error page to access proofpoint page
	let url;
	console.log(req);
	if (req.originUrl || req.initiator) {
		url = new URL(req.originUrl);
		url = url.origin + url.pathname;
		console.log(url);
		if (url == ERROR_PAGE || PPURLS.test(url))
			return;
	}
	// for webrequest
	if (typeof req == "object")
		url = req.url
	// for cpLinkSelection
	else if (!/^https?:\/\//.test(req))
		url = `https://${req}`;
	// for cpLink
	else
		url = req;

	let version;
	if (!(version = url.match(/^[^:]+:\/\/[^\/]+\/v([123])\/.+?/))) {
		return {
			redirectUrl: getErrorPage(url, error)
		};
	}
	console.log(`Redirecting: ${url}`);

	switch(version[1]){
		case '1':
			console.log("v1");
			return {
				redirectUrl: decodeV1(url, error)
			};
		case '2':
			console.log("v2");
			return {
				redirectUrl: decodeV2(url, error)
			};
		case '3':
			console.log("v3");
			return {
				redirectUrl: decodeV3(url, error)
			};
		default:
			// should not reach this point
			console.log("CRITICAL ERROR");
			return {
				redirectUrl: getErrorPage(req, error)
			};
	}
}


browser.contextMenus.onClicked.addListener((info) => {
	if (info.menuItemId == "cpLink") {
		clipboard(decode(info.linkUrl, 0).redirectUrl);
		return;
	}
	if (info.menuItemId == "cpLinkSelection") {
		clipboard(decode(info.selectionText, 0).redirectUrl);
		return;
	}
});

browser.webRequest.onBeforeRequest.addListener(
	decode,
	// <all_urls> is not used to stop chromium from redirecting error.html
	{urls: ["*://*/*"]},
	["blocking"]
);

browser.contextMenus.create({
		id: "cpLink",
		title: "Copy de-proofpointed link",
		contexts: ["link"],
		targetUrlPatterns: PPURLPATTERNS
	},
	() => void browser.runtime.lastError,
);

browser.contextMenus.create({
		id: "cpLinkSelection",
		title: "Copy de-proofpointed link (selection)",
		contexts: ["selection"],
	},
	() => void browser.runtime.lastError,
);
