import { useState, useEffect, useRef, useCallback } from "react";
import AircallPhone from "aircall-everywhere";

export type CallStatus = "idle" | "ringing" | "on_call";

interface UseAircallPhoneOptions {
  containerId: string;
  enabled: boolean;
  onCallEnded?: (callInfo: { duration: number; call_id: string }) => void;
}

interface UseAircallPhoneReturn {
  isLoggedIn: boolean;
  callStatus: CallStatus;
  activeCallId: string | null;
  error: string | null;
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
        onLogin: () => {
          setIsLoggedIn(true);
          setError(null);
        },
        onLogout: () => {
          setIsLoggedIn(false);
          setCallStatus("idle");
          setActiveCallId(null);
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

  return { isLoggedIn, callStatus, activeCallId, error, dial };
}
