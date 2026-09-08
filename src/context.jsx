import { createContext, useContext, useEffect, useState, useRef } from "react";
export const Context = createContext(null);
export const useApp = () => useContext(Context);
export function useRoute() {
  const [route, setRoute] = useState(location.pathname + location.search);
  const current = useRef(route);
  current.current = route;
  useEffect(() => {
    const update = () => {
      const target = location.pathname + location.search;
      if (
        !window.dispatchEvent(
          new CustomEvent("app-before-navigate", {
            cancelable: true,
            detail: { to: target },
          }),
        )
      ) {
        history.pushState({}, "", current.current);
        return;
      }
      setRoute(target);
    };
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  const go = (to, replace = false, options = {}) => {
    if (
      to !== current.current &&
      !window.dispatchEvent(
        new CustomEvent("app-before-navigate", {
          cancelable: true,
          detail: { to },
        }),
      )
    )
      return false;
    sessionStorage.setItem(
      `scroll:${location.pathname + location.search}`,
      String(window.scrollY),
    );
    history[replace ? "replaceState" : "pushState"]({}, "", to);
    setRoute(to);
    if (!options.preserveScroll) window.scrollTo(0, 0);
  };
  return [route, go];
}
