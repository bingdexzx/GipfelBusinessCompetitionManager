import { Module } from "@nestjs/common";
import { MessageController } from "./message.controller";
import { MessageService } from "./message.service";
import { RealtimeModule } from "../../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  controllers: [MessageController],
  providers: [MessageService],
  exports: [MessageService],
})
export class MessagesModule {}
