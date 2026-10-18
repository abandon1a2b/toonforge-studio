import {
  QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (count, error) =>
        error instanceof APIError && error.status < 500 ? false : count < 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
export async function get<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") q.set(k, String(v));
  });
  const r = await fetch("/api/v2/" + path + "?" + q, { signal });
  const d = await r.json();
  if (!r.ok) throw new APIError(d.error || "读取失败", r.status);
  return d as T;
}
export async function post<T>(path: string, payload: unknown): Promise<T> {
  const r = await fetch("/api/v2/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  if (!r.ok) throw new APIError(d.error || "保存失败", r.status);
  return d as T;
}
export function useAction<T = unknown>(path: string, message = "已保存") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) => post<T>(path, payload),
    onSuccess: () => {
      void client.invalidateQueries();
      if (message) toast.success(message);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function saveJSON(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
