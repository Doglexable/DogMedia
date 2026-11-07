(function () {
  var mode = localStorage.getItem("theme") || "system";
  if (["system", "light", "dark"].indexOf(mode) === -1) mode = "system";
  var resolved = mode === "system"
    ? (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
})();
