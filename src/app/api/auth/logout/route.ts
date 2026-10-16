import { NextResponse } from "next/server";
import { endAdminSession } from "@/lib/session";

export async function POST() {
  await endAdminSession();
  return NextResponse.json({ ok: true });
}
