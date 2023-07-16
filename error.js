let u
if (u = new URLSearchParams(window.location.search).get("u")) {
	document.getElementById("a").href = u;
	document.getElementById("a").innerHTML = u;
}
