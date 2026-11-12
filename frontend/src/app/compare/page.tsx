import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/api-state";
import { Compare } from "./compare";

export const metadata: Metadata = { title: "เทียบการสแกน" };

export default function ComparePage() {
  return (
    // Compare reads ?base= and ?head= with useSearchParams, which needs a Suspense boundary.
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <Compare />
    </Suspense>
  );
}
