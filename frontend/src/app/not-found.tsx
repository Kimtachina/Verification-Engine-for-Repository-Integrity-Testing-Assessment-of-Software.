import Link from "next/link";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageHero seed={404} label="Error 404" title="ไม่พบหน้านี้">
      <p className="text-muted-foreground">ลิงก์อาจผิด หรือหน้านี้ถูกย้ายไปแล้ว</p>
      <Button asChild>
        <Link href="/">กลับหน้าภาพรวม</Link>
      </Button>
    </PageHero>
  );
}
