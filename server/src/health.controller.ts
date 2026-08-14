import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/decorators/public.decorator";

@Controller()
export class HealthController {
  @Get("ping")
  @Public()
  ping() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
