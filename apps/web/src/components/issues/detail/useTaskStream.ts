import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { api } from '../../../api';
import { useWebSocket } from '../../../context/WebSocketContext';
import type { TaskMessage, WsMessage } from '@aquarium/shared';

/**
 * useTaskStream — single source of truth for live task message streaming.
 *
 * Boot sequence on a non-null taskId:
 *   1. Fetch initial history via GET /api/tasks/:id/messages?afterSeq=0 and
 *      seed `messages` + `lastSeqRef` from the response.
 *   2. Send WS `subscribe_task` with the watermark so the server's
 *      replay-buffer-live sequence fills any gap between the REST snapshot
 *      and the live broadcast point (Wave 0 ST2 invariant).
 *   3. Register an `addHandler('task:message', ...)` that dedupes on seq and
 *      pushes each new payload into `messages` via `startTransition` — this
 *      keeps the main thread unblocked under bursty arrival (§ST3).
 *
 * Visibility:
 *   • document.hidden → pauseTaskStream(taskId). Server drops live events.
 *   • document.visible → resumeTaskStream(taskId, lastSeqRef.current). CRITICAL:
 *     the resume watermark is the CURRENT value — never 0 — so the server's
 *     DESC-LIMIT-500 replay helper returns only the gap, not a full re-replay.
 *
 * Return shape:
 *   messages          — monotonically-appended state
 *   renderedMessages  — useDeferredValue(messages); lets virtualizer settle
 *                       during bursts without dropping frames (§ST3)
 *   isPaused          — true while document.hidden
 *   isReplaying       — true from resume/mount until 500 ms quiet; ReconnectBanner
 *                       in Wave 3 will read this
 *   lastSeq           — current watermark (useful for Wave 3 reconnect wiring)
 */

export interface UseTaskStreamReturn {
  messages: TaskMessage[];
  renderedMessages: TaskMessage[];
  isPaused: boolean;
  isReplaying: boolean;
  /**
   * True while the WebSocket connection is down. Computed from
   * `useWebSocket().isConnected === false`. Wave 3 ReconnectBanner renders
   * while `isReconnecting || isReplaying`.
   */
  isReconnecting: boolean;
  lastSeq: number;
}

export function useTaskStream({ taskId }: { taskId: string | null }): UseTaskStreamReturn {
  const {
    isConnected,
    requestTaskReplay,
    pauseTaskStream,
    resumeTaskStream,
    addHandler,
    removeHandler,
  } = useWebSocket();

  const [messages, setMessages] = useState<TaskMessage[]>([]);
  // useDeferredValue lets heavy render work (virtualizer, markdown) yield to
  // user input under a task:message burst — ST3 HARD invariant.
  const renderedMessages = useDeferredValue(messages);
  const [isPaused, setIsPaused] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);

  // useTransition lets setMessages writes run at non-urgent priority. The
  // destructured `startTransition` ref is stable across renders, so captured
  // handlers see the same function identity every time.
  const [, startTransition] = useTransition();

  // lastSeqRef is the live watermark. ALWAYS call resumeTaskStream with
  // lastSeqRef.current — never 0 — or the server re-replays history the
  // client already has (ST3 HARD invariant + server-side memory pressure).
  const lastSeqRef = useRef(0);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // wasConnectedRef tracks the previous value of `isConnected` across the
  // reconnect effect's renders. We only fire the resubscribe on a FALSE → TRUE
  // transition — the initial true (boot) is handled by the boot effect so a
  // naive truthy check would double-subscribe on mount.
  const wasConnectedRef = useRef(isConnected);

  const scheduleReplayingSettle = useCallback(() => {
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(() => setIsReplaying(false), 500);
  }, []);

  const handleIncoming = useCallback(
    (msg: WsMessage) => {
      // Cross-task isolation — a single hook instance is responsible for ONE
      // taskId, but the WS client receives events for every task subscribed in
      // the tab. Filter inline so handlers don't leak messages across panels.
      if (!taskId || msg.taskId !== taskId) return;

      const payload = msg.payload as TaskMessage | null | undefined;
      if (!payload || typeof payload.seq !== 'number') return;

      // Dedup on seq — reconnect / replay edges can double-deliver the same
      // row; the batcher's UNIQUE(task_id, seq) guarantees seq is monotonic
      // per task, so `seq <= lastSeqRef.current` is a safe drop rule.
      if (payload.seq <= lastSeqRef.current) return;

      lastSeqRef.current = payload.seq;
      startTransition(() => {
        setMessages((prev) => {
          const next = [...prev, payload];
          // Defence-in-depth (ST2 HARD): the server's buffer-replay-live
          // sequence already delivers seq ASC, so the hot path is in-order
          // and this branch returns immediately. A sort only runs on the
          // rare race where a live broadcast squeaks in before the server's
          // replay drain completes — belt + braces so the DOM never renders
          // out-of-order rows even if the server-side invariant regressed.
          const n = next.length;
          if (n < 2 || next[n - 1].seq > next[n - 2].seq) return next;
          return next.slice().sort((a, b) => a.seq - b.seq);
        });
      });
      scheduleReplayingSettle();
    },
    [taskId, scheduleReplayingSettle],
  );

  // Initial boot — REST seed + WS subscribe_task + handler registration.
  useEffect(() => {
    if (!taskId) return;

    let cancelled = false;
    // Reset local state when the hook is re-mounted with a different taskId
    // (e.g. user opens a fresh chat; latestTask flips to a new id). Without
    // this, stale messages from the previous task would render until the REST
    // promise resolves.
    setMessages([]);
    lastSeqRef.current = 0;
    setIsReplaying(true);

    (async () => {
      try {
        const data = await api.get<{ messages: TaskMessage[]; hasMore: boolean }>(
          '/tasks/' + taskId + '/messages?afterSeq=0',
        );
        if (cancelled) return;
        setMessages(data.messages);
        if (data.messages.length > 0) {
          lastSeqRef.current = data.messages[data.messages.length - 1].seq;
        }
      } catch {
        // Swallow — live broadcasts will populate state. Wave 3 adds an error
        // surface via ReconnectBanner.
      } finally {
        if (!cancelled) {
          // Fire subscribe_task unconditionally even when the REST seed
          // failed — the live stream is the canonical source for future rows.
          requestTaskReplay(taskId, lastSeqRef.current);
          scheduleReplayingSettle();
        }
      }
    })();

    addHandler('task:message', handleIncoming);
    return () => {
      cancelled = true;
      removeHandler('task:message', handleIncoming);
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    };
  }, [taskId, requestTaskReplay, addHandler, removeHandler, handleIncoming, scheduleReplayingSettle]);

  // Visibility handler — pause when the tab is hidden, resume with the
  // CURRENT watermark when the tab returns. This is the core of the ST3
  // background-tab backpressure mitigation.
  useEffect(() => {
    if (!taskId) return;
    const onVisibilityChange = () => {
      if (document.hidden) {
        pauseTaskStream(taskId);
        setIsPaused(true);
      } else {
        // HARD INVARIANT: pass the CURRENT watermark. Passing 0 here would
        // re-download every message we already have (500-row server cap) and
        // thrash the replay buffer; grep-acceptance checks this exact call.
        resumeTaskStream(taskId, lastSeqRef.current);
        setIsPaused(false);
        setIsReplaying(true);
        scheduleReplayingSettle();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [taskId, pauseTaskStream, resumeTaskStream, scheduleReplayingSettle]);

  // Reconnect handler — the core of the ST2 end-to-end contract.
  //
  // When the socket drops (WS `onclose` in WebSocketContext), `isConnected`
  // flips false. After the 3 s reconnect timer fires and the new socket
  // completes the auth handshake, `isConnected` flips back to true. At that
  // moment we must re-send `subscribe_task(taskId, lastSeqRef.current)` so
  // the server's buffer-replay-live sequence (Wave 0) closes any gap.
  //
  // We guard on the false → true transition explicitly via `wasConnectedRef`
  // — the boot path already sends the initial subscribe_task through the
  // REST-seed effect, so a naive `if (isConnected)` effect would double-fire
  // on mount. The ref is written immediately so the next render's compare is
  // correct; the 500 ms quiet timer paints the ReconnectBanner long enough
  // for the user to see "replaying" feedback even on near-instant replays.
  useEffect(() => {
    if (!taskId) return;
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = isConnected;
    if (!wasConnected && isConnected) {
      setIsReplaying(true);
      requestTaskReplay(taskId, lastSeqRef.current);
      scheduleReplayingSettle();
    }
  }, [taskId, isConnected, requestTaskReplay, scheduleReplayingSettle]);

  return {
    messages,
    renderedMessages,
    isPaused,
    isReplaying,
    // isReconnecting is a pure derived view of the WebSocketContext state —
    // not a hook-owned flag. Putting it on the return means the ReconnectBanner
    // can read a single stream object rather than juggling useWebSocket().
    isReconnecting: !isConnected,
    lastSeq: lastSeqRef.current,
  };
}
