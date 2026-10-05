import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 20 * 60_000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1
    }
  }
});

export const queryKeys = {
  currentUser: ["currentUser"],
  resource: (resource, params = {}) => ["resource", resource, params],
  summary: (params = {}) => ["dashboard", params],
  reports: (params = {}) => ["reports", params],
  notifications: (params = {}) => ["notifications", params],
  obligation: (id) => ["obligation", id]
};

export function invalidateFinancialQueries(client = queryClient, event = {}) {
  const type = String(event.type || "");
  client.invalidateQueries({ queryKey: ["dashboard"] });
  client.invalidateQueries({ queryKey: ["resource", "accounts"] });
  client.invalidateQueries({ queryKey: ["resource", "activity"] });

  if (/settlement|obligation|paid_for_someone|paid_by_someone|borrow|lend/i.test(type)) {
    client.invalidateQueries({ queryKey: ["resource", "people"] });
    client.invalidateQueries({ queryKey: ["resource", "obligations"] });
  }

  if (/notification/i.test(type)) {
    client.invalidateQueries({ queryKey: ["notifications"] });
  }

  if (event.obligationId) client.invalidateQueries({ queryKey: queryKeys.obligation(event.obligationId) });
  client.invalidateQueries({ queryKey: ["reports"] });
}
