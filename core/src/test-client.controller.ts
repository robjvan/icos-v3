import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

/**
 * Serves the Milestone 1 browser test client (`core/test-client.html`).
 * Same-origin with the API, so the browser never hits CORS.
 * Not a product interface — real Web/Desktop clients come later (core.md).
 */
@Controller()
export class TestClientController {
  @Get()
  @Header('Content-Type', 'text/html')
  getTestClient(): StreamableFile {
    return new StreamableFile(
      createReadStream(join(__dirname, '..', 'test-client.html')),
    );
  }
}
