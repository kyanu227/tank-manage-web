import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./config";

export interface CustomerDestinationPayload {
  uid: string;
  name?: string;
  companyName?: string;
  formalName?: string;
  lineName?: string;
  email?: string;
  loginId?: string;
  passcode?: string;
  price10?: number;
  price12?: number;
  priceAluminum?: number;
  isActive?: boolean;
}

export async function syncCustomerDestination(payload: CustomerDestinationPayload) {
  const destRef = doc(db, "destinations", payload.uid);
  const snap = await getDoc(destRef);

  const base = {
    name: payload.name || payload.companyName || payload.formalName || payload.lineName || "顧客",
    formalName: payload.formalName || payload.companyName || "",
    companyName: payload.companyName || "",
    lineName: payload.lineName || "",
    email: payload.email || "",
    loginId: payload.loginId || payload.email || payload.uid,
    passcode: payload.passcode || "",
    price10: payload.price10 ?? 0,
    price12: payload.price12 ?? 0,
    priceAluminum: payload.priceAluminum ?? 0,
    isActive: payload.isActive ?? true,
    customerUid: payload.uid,
    updatedAt: serverTimestamp(),
  };

  if (snap.exists()) {
    await updateDoc(destRef, base);
  } else {
    await setDoc(destRef, { ...base, createdAt: serverTimestamp(), });
  }
}
