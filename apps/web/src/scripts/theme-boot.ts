/**
 * Skrip boot preferensi tampilan, diadaptasi dari next-shadcn-admin-dashboard-aria (MIT).
 * Dijalankan sekali sebelum React render supaya tema dan layout tidak berkedip.
 */
import { PREFERENCE_REGISTRY } from "@/lib/preferences/preferences-config";

const BOOT_CODE = `(function () {
      try {
        var root = document.documentElement;
        var REGISTRY = REGISTRY_ARG;

        function readCookie(name) {
          var match = document.cookie.split("; ").find(function(c) {
            return c.startsWith(name + "=");
          });
          return match ? decodeURIComponent(match.split("=")[1]) : null;
        }

        function readLocal(name) {
          try {
            return window.localStorage.getItem(name);
          } catch (e) {
            return null;
          }
        }

        function readPreference(key, definition) {
          var mode = definition.persistence;
          var value = null;

          if (mode === "localStorage") {
            value = readLocal(key);
          }

          if (!value && (mode === "client-cookie" || mode === "server-cookie")) {
            value = readCookie(key);
          }

          return definition.values.indexOf(value) >= 0 ? value : definition.defaultValue;
        }

        var preferences = {};

        Object.keys(REGISTRY).forEach(function(key) {
          var definition = REGISTRY[key];
          var value = readPreference(key, definition);

          preferences[key] = value;
          root.setAttribute(definition.attribute, value);
        });

        var mode = preferences.theme_mode;
        var resolvedMode =
          mode === "system" && window.matchMedia
            ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
            : mode === "dark"
              ? "dark"
              : "light";

        root.classList.toggle("dark", resolvedMode === "dark");
        root.style.colorScheme = resolvedMode;

      } catch (e) {
        console.warn("ThemeBootScript error:", e);
      }
    })();`;

export function runThemeBoot() {
  // Argumen REGISTRY_ARG dipakai oleh BOOT_CODE; isinya konfigurasi preferensi internal.
  new Function("REGISTRY_ARG", BOOT_CODE)(PREFERENCE_REGISTRY);
}
