"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  getJobStatusLabel,
  isTerminalJobStatus,
  type JobErrorResponse,
  type JobStatusResponse,
} from "@/types/job";

type UseJobPollOptions = {
  enabled?: boolean;
  initialDelayMs?: number;
  maxDelayMs?: number;
  pauseWhenHidden?: boolean;
};

type UseJobPollResult = {
  cancel: () => void;
  data: JobStatusResponse | null;
  error: string | null;
  isLoading: boolean;
  isPaused: boolean;
  isPolling: boolean;
  restart: () => void;
};

function getNextDelay(delayMs: number, maxDelayMs: number) {
  return Math.min(delayMs * 2, maxDelayMs);
}

async function parseResponseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function isTerminalPollError(message: string) {
  return message === "JOB_EXPIRED" || message === "Not found";
}

export function useJobPoll(
  jobId: string | null | undefined,
  options: UseJobPollOptions = {}
): UseJobPollResult {
  const {
    enabled = true,
    initialDelayMs = 500,
    maxDelayMs = 5000,
    pauseWhenHidden = true,
  } = options;
  const normalizedJobId = jobId?.trim() || "";
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const delayRef = useRef(initialDelayMs);
  const isStoppedRef = useRef(false);
  const isTerminalRef = useRef(false);
  const [data, setData] = useState<JobStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [restartToken, setRestartToken] = useState(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const abortInFlight = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const stopPolling = useCallback(() => {
    isStoppedRef.current = true;
    isTerminalRef.current = false;
    clearTimer();
    abortInFlight();
    setData(null);
    setError(null);
    setIsLoading(false);
    setIsPaused(false);
    setIsPolling(false);
  }, [abortInFlight, clearTimer]);

  const restart = useCallback(() => {
    setRestartToken((current) => current + 1);
  }, []);

  const cancel = useCallback(() => {
    stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    if (!normalizedJobId || !enabled) {
      stopPolling();
      setData(null);
      setError(null);
      return;
    }

    let isMounted = true;

    isStoppedRef.current = false;
    isTerminalRef.current = false;
    delayRef.current = initialDelayMs;
    setData(null);
    setError(null);
    setIsPaused(Boolean(pauseWhenHidden && document.hidden));
    setIsPolling(true);

    const scheduleNext = (delayMs: number, poll: () => Promise<void>) => {
      if (!isMounted || isStoppedRef.current || isTerminalRef.current) {
        return;
      }

      if (pauseWhenHidden && document.hidden) {
        setIsPaused(true);
        setIsPolling(false);
        return;
      }

      setIsPaused(false);
      setIsPolling(true);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (!isMounted || isStoppedRef.current || isTerminalRef.current) {
        return;
      }

      if (pauseWhenHidden && document.hidden) {
        setIsPaused(true);
        setIsPolling(false);
        return;
      }

      setIsPaused(false);
      setIsPolling(true);
      setIsLoading(true);
      abortInFlight();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(
          `/api/jobs/${encodeURIComponent(normalizedJobId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );
        const errorPayload = response.ok
          ? null
          : await parseResponseJson<JobErrorResponse>(response);

        if (!response.ok) {
          throw new Error(
            errorPayload?.error || "Unable to load job status"
          );
        }

        const payload = await parseResponseJson<JobStatusResponse>(response);

        if (!payload) {
          throw new Error("Unable to load job status");
        }

        if (!isMounted || isStoppedRef.current) {
          return;
        }

        setData(payload);
        setError(null);

        if (isTerminalJobStatus(payload.status)) {
          isTerminalRef.current = true;
          setIsPolling(false);
          return;
        }

        const nextDelay = delayRef.current;
        delayRef.current = getNextDelay(delayRef.current, maxDelayMs);
        scheduleNext(nextDelay, poll);
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        if (!isMounted || isStoppedRef.current) {
          return;
        }

        isTerminalRef.current = true;
        const message =
          caughtError instanceof Error && caughtError.message.trim()
            ? caughtError.message
            : "Unable to load job status";

        setError(message);

        if (isTerminalPollError(message)) {
          setIsPolling(false);
          return;
        }

        isTerminalRef.current = false;
        const nextDelay = delayRef.current;
        delayRef.current = getNextDelay(delayRef.current, maxDelayMs);
        scheduleNext(nextDelay, poll);
      } finally {
        if (!isMounted || abortRef.current !== controller) {
          return;
        }

        abortRef.current = null;
        setIsLoading(false);
      }
    };

    const handleVisibilityChange = () => {
      if (!pauseWhenHidden || isStoppedRef.current || isTerminalRef.current) {
        return;
      }

      if (document.hidden) {
        clearTimer();
        abortInFlight();
        setIsLoading(false);
        setIsPaused(true);
        setIsPolling(false);
        return;
      }

      setIsPaused(false);
      setIsPolling(true);
      void poll();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void poll();

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimer();
      abortInFlight();
    };
  }, [
    abortInFlight,
    clearTimer,
    enabled,
    initialDelayMs,
    maxDelayMs,
    normalizedJobId,
    pauseWhenHidden,
    restartToken,
    stopPolling,
  ]);

  return {
    cancel,
    data,
    error,
    isLoading,
    isPaused,
    isPolling,
    restart,
  };
}
