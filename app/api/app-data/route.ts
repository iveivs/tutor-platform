import { handleGetAppData } from "@/lib/app-data/read-handler";
import { handleWriteAppData } from "@/lib/app-data/write-handler";

export async function GET(request: Request) {
  return handleGetAppData(request);
}

export async function POST(request: Request) {
  return handleWriteAppData(request);
}
