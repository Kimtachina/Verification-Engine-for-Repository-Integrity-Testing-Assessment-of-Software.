import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="slash-label">Error 404</p>
      <h1 className="font-display text-4xl leading-tight font-black tracking-tight sm:text-5xl">
        ไม่พบหน้านี้
      </h1>
      <p className="text-muted-foreground">ลิงก์อาจผิด หรือหน้านี้ถูกย้ายไปแล้ว</p>
      <Button asChild>
        <Link href="/">กลับหน้าภาพรวม</Link>
      </Button>
    </div>
  );
}
