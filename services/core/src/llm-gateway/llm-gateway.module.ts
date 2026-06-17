import { Module } from '@nestjs/common';
import { LlmGatewayService } from './llm-gateway.service';

@Module({
  providers: [LlmGatewayService],
  exports: [LlmGatewayService],
})
export class LlmGatewayModule {}
