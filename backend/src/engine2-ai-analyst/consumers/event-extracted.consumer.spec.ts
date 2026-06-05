import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { EventExtractedConsumer } from './event-extracted.consumer';
import { AiAnalystService } from '../ai-analyst.service';
import { JOB, AiAnalyzeJobData } from '../../common/queues/queue.constants';

const mockAiAnalystService = {
  runSummary: jest.fn(),
};

function makeJob(name: string, data: AiAnalyzeJobData): Job<AiAnalyzeJobData> {
  return { name, data } as unknown as Job<AiAnalyzeJobData>;
}

describe('EventExtractedConsumer', () => {
  let consumer: EventExtractedConsumer;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventExtractedConsumer,
        { provide: AiAnalystService, useValue: mockAiAnalystService },
      ],
    }).compile();

    consumer = module.get<EventExtractedConsumer>(EventExtractedConsumer);
  });

  it('event.extracted 잡을 수신하면 runSummary를 호출한다', async () => {
    const data: AiAnalyzeJobData = {
      rcpNo: '20240601000001',
      corpCode: '00126380',
      eventType: 'SUPPLY_CONTRACT',
      polarity: 'POSITIVE',
      confidence: 0.9,
      isAiAssisted: false,
    };

    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await consumer.process(makeJob(JOB.EVENT_EXTRACTED, data));

    expect(mockAiAnalystService.runSummary).toHaveBeenCalledTimes(1);
    expect(mockAiAnalystService.runSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ rcpNo: '20240601000001' }),
      }),
    );
  });

  it('알 수 없는 잡 이름은 runSummary를 호출하지 않는다', async () => {
    const data: AiAnalyzeJobData = {
      rcpNo: '20240601000002',
      corpCode: '00126380',
      eventType: 'OTHER',
      polarity: 'NEUTRAL',
      confidence: 0.5,
      isAiAssisted: false,
    };

    await consumer.process(makeJob('unknown.job', data));

    expect(mockAiAnalystService.runSummary).not.toHaveBeenCalled();
  });

  it('runSummary가 예외를 던지면 컨슈머가 예외를 전파한다(BullMQ 재시도)', async () => {
    const data: AiAnalyzeJobData = {
      rcpNo: '20240601000003',
      corpCode: '00126380',
      eventType: 'CB_ISSUANCE',
      polarity: 'NEGATIVE',
      confidence: 0.8,
      isAiAssisted: false,
    };

    mockAiAnalystService.runSummary.mockRejectedValue(new Error('LLM timeout'));

    await expect(consumer.process(makeJob(JOB.EVENT_EXTRACTED, data))).rejects.toThrow(
      'LLM timeout',
    );
  });
});
