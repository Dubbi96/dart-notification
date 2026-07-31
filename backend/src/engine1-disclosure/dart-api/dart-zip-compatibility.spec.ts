import { ConfigService } from '@nestjs/config';
import * as AdmZip from 'adm-zip';

import { DartApiService } from './dart-api.service';

describe('adm-zip 0.6 DART document compatibility', () => {
  let service: DartApiService;

  beforeEach(() => {
    const config = {
      get: jest.fn().mockReturnValue('TEST_KEY'),
    } as unknown as ConfigService;
    service = new DartApiService(config);
  });

  it('extracts the exact receipt-number document first', async () => {
    const zip = new AdmZip();
    zip.addFile('larger.xml', Buffer.from('<root>larger fallback</root>'));
    zip.addFile('20260731000001.html', Buffer.from('<p>exact report</p>'));

    await expect(service.extractDocumentFromZip(zip.toBuffer(), '20260731000001')).resolves.toEqual(
      {
        xml: undefined,
        html: '<p>exact report</p>',
      },
    );
  });

  it('keeps the largest XML/HTML fallback contract', async () => {
    const zip = new AdmZip();
    zip.addFile('small.xml', Buffer.from('<x/>'));
    zip.addFile('large.xml', Buffer.from('<root>largest xml</root>'));
    zip.addFile('report.html', Buffer.from('<p>html</p>'));

    await expect(service.extractDocumentFromZip(zip.toBuffer())).resolves.toEqual({
      xml: '<root>largest xml</root>',
      html: '<p>html</p>',
    });
  });
});
