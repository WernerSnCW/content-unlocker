import { useState, useEffect, useRef, useCallback } from "react";
import AircallPhone from "aircall-everywhere";

export type CallStatus = "idle" | "ringing" | "on_call";

interface UseAircallPhoneOptions {
  containerId: string;
  enabled: boolean;
  onCallEnded?: (callInfo: { duration: number; call_id: string }) => void;
}

export interface AircallUserInfo {
  /** Aircall numeric user ID — matches agents.aircall_user_id in our DB */
  id: number | null;
  email: string | null;
  name: string | null;
}

interface UseAircallPhoneReturn {
  isLoggedIn: boolean;
  callStatus: CallStatus;
  activeCallId: string | null;
  error: string | null;
  /** Info about the Aircall user logged into the embedded widget. Populated
   *  after onLogin fires; null until then. Used to detect mismatches against
   *  the app's logged-in agent. */
  aircallUser: AircallUserInfo | null;
  dial: (phoneNumber: string) => void;
}

export function useAircallPhone({
  containerId,
  enabled,
  onCallEnded,
}: UseAircallPhoneOptions): UseAircallPhoneReturn {
  const phoneRef = useRef<AircallPhone | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aircallUser, setAircallUser] = useState<AircallUserInfo | null>(null);

  useEffect(() => {
    if (!enabled) {
      setError(null);
      setIsLoggedIn(false);
      return;
    }

    const container = document.getElementById(containerId);
    if (!container) return;

    // Clear any previous iframe
    container.innerHTML = "";

    try {
      const phone = new AircallPhone({
        domToLoadWorkspace: `#${containerId}`,
        onLogin: (payload: any) => {
          setIsLoggedIn(true);
          setError(null);
          // The Aircall Everywhere SDK passes { user, settings } on login.
          // `user` has at least { user_id, user_email, user_name } (exact
          // shape varies across SDK versions). Defensive parsing handles
          // snake_case, camelCase, and nested shapes.
          const u = payload?.user ?? payload ?? {};
          const rawId = u.user_id ?? u.userId ?? u.id ?? null;
          const id = rawId != null && !Number.isNaN(Number(rawId)) ? Number(rawId) : null;
          const email = (u.user_email ?? u.email ?? null) || null;
          const nameFirst = u.user_first_name ?? u.firstName ?? "";
          const nameLast = u.user_last_name ?? u.lastName ?? "";
          const nameFull = u.user_name ?? u.name ?? `${nameFirst} ${nameLast}`.trim();
          setAircallUser({ id, email, name: nameFull || null });
        },
        onLogout: () => {
          setIsLoggedIn(false);
          setCallStatus("idle");
          setActiveCallId(null);
          setAircallUser(null);
        },
        size: "auto",
        debug: false,
      });

      phone.on("incoming_call", () => {
        setCallStatus("ringing");
      });

      phone.on("outgoing_call", (data: any) => {
        setCallStatus("on_call");
        if (data?.call_id) setActiveCallId(String(data.call_id));
      });

      phone.on("outgoing_answered", () => {
        setCallStatus("on_call");
      });

      phone.on("call_ended", (data: any) => {
        setCallStatus("idle");
        setActiveCallId(null);
        if (onCallEnded && data) {
          onCallEnded({
            duration: data.duration || 0,
            call_id: String(data.call_id || ""),
          });
        }
      });

      phone.on("call_end_ringtone", () => {
        setCallStatus("idle");
        setActiveCallId(null);
      });

      phoneRef.current = phone;
    } catch (err: any) {
      setError(err.message || "Failed to initialize Aircall widget");
    }

    return () => {
      phoneRef.current = null;
      const el = document.getElementById(containerId);
      if (el) el.innerHTML = "";
    };
  }, [enabled, containerId]);

  const dial = useCallback(
    (phoneNumber: string) => {
      if (!phoneRef.current) {
        setError("Aircall not ready");
        return;
      }
      if (callStatus !== "idle") return;

      setError(null);
      phoneRef.current.send(
        "dial_number",
        { phone_number: phoneNumber },
        (success: boolean, data: any) => {
          if (!success) {
            setError(data?.message || "Failed to dial");
            // Clear error after 3 seconds
            setTimeout(() => setError(null), 3000);
          }
        }
      );
    },
    [callStatus]
  );

  return { isLoggedIn, callStatus, activeCallId, error, aircallUser, dial };
}
