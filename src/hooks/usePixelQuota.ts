import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuthStore } from '../stores/authStore';

const MAX_PIXELS = 50;
const COOLDOWN_HOURS = 12;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

interface PixelQuotaState {
  remaining: number;
  total: number;
  nextRefresh: Date | null;
  loading: boolean;
  cooldownText: string;
}

export function usePixelQuota() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<PixelQuotaState>({
    remaining: MAX_PIXELS,
    total: MAX_PIXELS,
    nextRefresh: null,
    loading: true,
    cooldownText: '',
  });

  const fetchQuota = useCallback(async () => {
    if (!user) {
      setState((prev) => ({ ...prev, remaining: 0, loading: false }));
      return;
    }

    const since = new Date(Date.now() - COOLDOWN_MS).toISOString();

    const { count, data } = await supabase
      .from('pixels')
      .select('painted_at', { count: 'exact' })
      .eq('user_id', user.id)
      .gte('painted_at', since)
      .order('painted_at', { ascending: true });

    const used = count ?? 0;
    const remaining = Math.max(0, MAX_PIXELS - used);

    let nextRefresh: Date | null = null;
    if (remaining === 0 && data && data.length > 0) {
      // The earliest pixel will expire first (after COOLDOWN_MS from when it was placed)
      const earliestPaintedAt = new Date(data[0].painted_at);
      nextRefresh = new Date(earliestPaintedAt.getTime() + COOLDOWN_MS);
    }

    setState({
      remaining,
      total: MAX_PIXELS,
      nextRefresh,
      loading: false,
      cooldownText: '',
    });
  }, [user]);

  // Decrement locally when user paints
  const decrementLocal = useCallback(() => {
    setState((prev) => ({
      ...prev,
      remaining: Math.max(0, prev.remaining - 1),
    }));
  }, []);

  // Increment locally when user deletes a pixel
  const incrementLocal = useCallback(() => {
    setState((prev) => ({
      ...prev,
      remaining: Math.min(MAX_PIXELS, prev.remaining + 1),
    }));
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  // Cooldown timer
  useEffect(() => {
    if (state.remaining > 0 || !state.nextRefresh) {
      setState((prev) => ({ ...prev, cooldownText: '' }));
      return;
    }

    const tick = () => {
      const now = Date.now();
      const diff = state.nextRefresh!.getTime() - now;

      if (diff <= 0) {
        fetchQuota();
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setState((prev) => ({
        ...prev,
        cooldownText: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      }));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state.remaining, state.nextRefresh, fetchQuota]);

  return { ...state, decrementLocal, incrementLocal, refetch: fetchQuota };
}
