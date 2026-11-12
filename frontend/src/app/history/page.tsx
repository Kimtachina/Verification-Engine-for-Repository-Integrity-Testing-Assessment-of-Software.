import type { Metadata } from "next";
import { History } from "./history";

export const metadata: Metadata = { title: "ประวัติ" };

export default function HistoryPage() {
  return <History />;
}
