import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Message, MessageContentType } from './entities/message.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  async saveMessage(
    userId: string,
    groupId: string,
    contentType: MessageContentType,
    rawContent: string,
  ): Promise<Message> {
    const message: Message = this.messageRepository.create({
      sender: { id: userId },
      groupId,
      contentType,
      rawContent,
    });

    return this.messageRepository.save(message);
  }

  async getGroupMessages(groupId: string): Promise<Message[]> {
    return this.messageRepository.find({
      where: { groupId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
