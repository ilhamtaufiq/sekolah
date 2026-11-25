import { useAuth } from "../../lib/auth";

/** Token sesi aktif untuk unduhan dan unggahan yang memakai fetch langsung. */
export function useToken(): string | null {
  return useAuth().token;
}
