import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pushSupported, subscribeToPush } from "./push";
import { useConfig, useDevices, useRegisterDevice } from "./queries";

export type PushPromptStatus = "checking" | "hidden" | "ask" | "finish";

const DISMISS_KEY = "dueradar:push-dismissed";

function platform(): string {
  if (typeof navigator === "undefined") return "web";
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "ios";
  if (/android/i.test(navigator.userAgent)) return "android";
  return "web";
}

/**
 * Watches notification permission and push registration in the background so
 * the app can nudge the user when reminders are not actually enabled yet.
 *
 * - "checking" permission/registration is still being resolved.
 * - "ask"      the browser permission was never decided ("default"). It can
 *              only be requested from a user gesture, which the banner's
 *              button provides.
 * - "finish"   permission is granted, but this browser's push endpoint is not
 *              registered with the API, so reminders cannot be delivered here.
 * - "hidden"   everything enabled, blocked, unsupported, or dismissed.
 */
export function usePushPrompt() {
  const config = useConfig();
  const devices = useDevices();
  const registerDevice = useRegisterDevice();
  const queryClient = useQueryClient();

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [enabling, setEnabling] = useState(false);
  const [status, setStatus] = useState<PushPromptStatus>("checking");
  // Endpoint of this browser's service worker push subscription; undefined
  // until the service worker is ready and it has been read.
  const [subscribedEndpoint, setSubscribedEndpoint] = useState<string | null | undefined>(
    undefined,
  );
  // Bumped after enable attempts and permission changes so the status effect
  // re-reads Notification.permission, which is not reactive on its own.
  const [permissionEpoch, setPermissionEpoch] = useState(0);

  // Read the current subscription once the service worker is active, and
  // re-read after each enable attempt in case one was just created.
  useEffect(() => {
    if (!pushSupported()) return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) setSubscribedEndpoint(subscription?.endpoint ?? null);
      })
      .catch(() => {
        if (!cancelled) setSubscribedEndpoint(null);
      });
    return () => {
      cancelled = true;
    };
  }, [permissionEpoch]);

  // Follow permission changes made outside the app (e.g. the user flips the
  // site permission in browser settings while a tab is open). Chromium-only
  // nicety; elsewhere the status refreshes on the next attempt or page load.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    let permissionStatus: PermissionStatus | undefined;
    const onChange = () => setPermissionEpoch((n) => n + 1);
    try {
      navigator.permissions
        .query({ name: "notifications" })
        .then((queried) => {
          permissionStatus = queried;
          queried.addEventListener("change", onChange);
        })
        .catch(() => undefined);
    } catch {
      /* the query is unsupported on some browsers */
    }
    return () => {
      permissionStatus?.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    const vapidKey = config.data?.vapidPublicKey;
    if (!pushSupported() || !vapidKey) {
      setStatus("hidden");
      return;
    }
    const permission = Notification.permission;
    if (permission === "denied") {
      setStatus("hidden");
      return;
    }
    if (permission === "default") {
      setStatus(dismissed ? "hidden" : "ask");
      return;
    }
    // Permission granted: a banner only helps if this browser is not
    // registered as a device yet, so wait for both sides to be known.
    if (devices.isError) {
      setStatus("hidden");
      return;
    }
    if (devices.isLoading || devices.data === undefined || subscribedEndpoint === undefined) {
      setStatus("checking");
      return;
    }
    if (!devices.data.pushConfigured) {
      setStatus("hidden");
      return;
    }
    const registered = devices.data.devices.some(
      (device) => device.endpoint && device.endpoint === subscribedEndpoint,
    );
    setStatus(registered || dismissed ? "hidden" : "finish");
  }, [config.data, devices.data, devices.isError, devices.isLoading, subscribedEndpoint, dismissed, permissionEpoch]);

  const enable = useCallback(async (): Promise<boolean> => {
    const vapidKey = config.data?.vapidPublicKey;
    if (!vapidKey) return false;
    setEnabling(true);
    try {
      const subscription = await subscribeToPush(vapidKey);
      await registerDevice.mutateAsync({
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        platform: platform(),
      });
      setSubscribedEndpoint(subscription.endpoint);
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      return true;
    } catch {
      // The prompt was denied or a step failed. Bump the epoch so the status
      // effect re-reads Notification.permission and settles the banner.
      setPermissionEpoch((n) => n + 1);
      return false;
    } finally {
      setEnabling(false);
    }
  }, [config.data, registerDevice, queryClient]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage can be blocked */
    }
  }, []);

  return { status, enabling, enable, dismiss };
}
