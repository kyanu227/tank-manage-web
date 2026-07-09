import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export interface MonthlyStat {
  id: string;
  month: string;
  location: string;
  lends: number;
  returns: number;
  unused: number;
  defaults: number;
}

export async function getMonthlyStats(): Promise<MonthlyStat[]> {
  const snap = await getDocs(query(collection(db, "monthly_stats"), orderBy("month", "desc")));
  const list: MonthlyStat[] = [];
  snap.forEach((docSnap) => {
    list.push({ id: docSnap.id, ...docSnap.data() } as MonthlyStat);
  });
  return list;
}
