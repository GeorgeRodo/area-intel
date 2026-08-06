"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Poll a callback on an interval, but only while the tab is actually being
 * looked at. A background tab that keeps hitting the API for hours is the
 * usual way a dashboard turns into a rate-limit problem.
 */
export function usePoll(callback, intervalMs) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!intervalMs) return;
    let id;
    const stop = () => {
      clearInterval(id);
      id = undefined;
    };
    const start = () => {
      stop();
      id = setInterval(() => cbRef.current(), intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        cbRef.current(); // catch up on whatever was missed while hidden
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}

/**
 * Load something async and keep loading/error/data in one place.
 *
 * Every panel used to hand-roll this with three useStates and no guard against
 * a slow response for the *previous* municipality landing after a fast one for
 * the current — the request token below drops out-of-order and post-unmount
 * results instead of writing them to state.
 *
 * @param fn      async loader; re-run whenever `deps` change
 * @param deps    dependency list, same semantics as useEffect
 * @param options pollMs: refresh interval (visibility-aware, 0 = off)
 *                enabled: skip loading entirely while false
 */
export function useAsync(fn, deps = [], { pollMs = 0, enabled = true } = {}) {
  const [state, setState] = useState({
    data: undefined,
    error: null,
    loading: enabled,
  });

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const tokenRef = useRef(0);

  const run = useCallback(
    async ({ quiet = false } = {}) => {
      const token = ++tokenRef.current;
      if (!quiet) setState((s) => ({ ...s, loading: true }));
      try {
        const data = await fnRef.current();
        if (token === tokenRef.current) {
          setState({ data, error: null, loading: false });
        }
        return data;
      } catch (e) {
        if (token === tokenRef.current) {
          setState((s) => ({
            data: s.data,
            error: e?.message || String(e),
            loading: false,
          }));
        }
        return undefined;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, enabled]
  );

  useEffect(() => {
    if (!enabled) {
      setState({ data: undefined, error: null, loading: false });
      return;
    }
    run();
    // Bumping the token invalidates anything still in flight when deps change
    // or the component unmounts.
    return () => {
      tokenRef.current++;
    };
  }, [run, enabled]);

  const reload = useCallback(() => run(), [run]);
  const refreshQuietly = useCallback(() => run({ quiet: true }), [run]);

  usePoll(refreshQuietly, enabled ? pollMs : 0);

  return { ...state, reload, refreshQuietly };
}
