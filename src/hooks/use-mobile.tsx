import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    // Read the initial value via a task so the effect body itself stays free
    // of synchronous setState calls.
    const id = window.setTimeout(onChange, 0);
    return () => {
      window.clearTimeout(id);
      mql.removeEventListener("change", onChange);
    };
  }, []);

  return !!isMobile;
}
