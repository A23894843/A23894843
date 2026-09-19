(function () {
    "use strict";

    const KEY = "portfolio-theme";

    function preferredTheme() {
        return window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
    }

    function getTheme() {
        const saved = localStorage.getItem(KEY);
        return saved === "light" || saved === "dark" ? saved : preferredTheme();
    }

    function applyTheme(theme) {
        const value = theme === "light" ? "light" : "dark";
        document.documentElement.dataset.theme = value;
        localStorage.setItem(KEY, value);

        document.querySelectorAll("[data-theme-toggle]").forEach(button => {
            const next = value === "dark" ? "light" : "dark";
            button.textContent = next === "light" ? "☀ LIGHT" : "☾ DARK";
            button.setAttribute("aria-label", `Switch to ${next} theme`);
            button.setAttribute("title", `Switch to ${next} theme`);
        });
    }

    // Apply before the page becomes interactive.
    applyTheme(getTheme());

    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll("[data-theme-toggle]").forEach(button => {
            button.addEventListener("click", () => {
                const current = document.documentElement.dataset.theme;
                applyTheme(current === "dark" ? "light" : "dark");
            });
        });
        applyTheme(document.documentElement.dataset.theme || getTheme());
    });
})();
