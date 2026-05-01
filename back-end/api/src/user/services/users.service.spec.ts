import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { UserEntity } from '../entities/user.entity';
import { EncryptionTransformer } from 'src/shared/transformers/encryption.transformer';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeUserEntity(overrides: Partial<UserEntity> = {}): UserEntity {
  return Object.assign(new UserEntity(), {
    id: 1,
    name: 'admin',
    email: 'admin@climsoft.org',
    phone: null,
    hashedPassword: '$2b$10$placeholder',
    isSystemAdmin: true,
    permissions: null,
    groupId: null,
    extraMetadata: null,
    disabled: false,
    comment: null,
    entryDateTime: new Date(),
    log: null,
    group: null,
    ...overrides,
  });
}

// Minimal mock that the UsersService cache will call during onModuleInit
const mockRepo = () => ({
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

// ── EncryptionTransformer unit tests ─────────────────────────────────────────

describe('EncryptionTransformer', () => {
  const transformer = new EncryptionTransformer();

  it('to() produces ivHex:encHex format', () => {
    const result = transformer.to('admin@climsoft.org');
    expect(EncryptionTransformer.isEncrypted(result)).toBe(true);
  });

  it('from() decrypts back to original value', () => {
    const encrypted = transformer.to('admin@climsoft.org');
    expect(transformer.from(encrypted)).toBe('admin@climsoft.org');
  });

  it('from() returns plaintext as-is (legacy row compatibility)', () => {
    expect(transformer.from('admin@climsoft.org')).toBe('admin@climsoft.org');
  });

  it('from() does not misidentify email with colon as encrypted', () => {
    // An email like user:name@example.com contains ':' but is NOT encrypted.
    expect(transformer.from('user:name@example.com')).toBe('user:name@example.com');
  });

  it('isEncrypted() correctly identifies encrypted vs plaintext values', () => {
    const enc = transformer.to('test@example.com');
    expect(EncryptionTransformer.isEncrypted(enc)).toBe(true);
    expect(EncryptionTransformer.isEncrypted('test@example.com')).toBe(false);
    expect(EncryptionTransformer.isEncrypted('user:name@example.com')).toBe(false);
  });
});

// ── UsersService.findUserByCredentials ───────────────────────────────────────

describe('UsersService.findUserByCredentials', () => {
  let service: UsersService;
  let repo: ReturnType<typeof mockRepo>;

  const PLAIN_EMAIL = 'admin@climsoft.org';
  const PASSWORD = '123';

  beforeEach(async () => {
    repo = mockRepo();

    // Return one user so the cache loads successfully
    const entity = makeUserEntity({ email: PLAIN_EMAIL });
    repo.find.mockResolvedValue([entity]);
    repo.findOneBy.mockResolvedValue(entity);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(UserEntity), useValue: repo },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    await service.onModuleInit();           // loads cache
  });

  it('succeeds when cache has plaintext email and password matches', async () => {
    const hashed = await bcrypt.hash(PASSWORD, 10);
    const entity = makeUserEntity({ email: PLAIN_EMAIL, hashedPassword: hashed });
    repo.findOneBy.mockResolvedValue(entity);

    const result = await service.findUserByCredentials({ email: PLAIN_EMAIL, password: PASSWORD });
    expect(result.email).toBe(PLAIN_EMAIL);
  });

  it('succeeds when cache email was decrypted from an encrypted DB row', async () => {
    // Simulate: cache loaded after DB was re-encrypted — from() decrypted back to plaintext
    const hashed = await bcrypt.hash(PASSWORD, 10);
    const entity = makeUserEntity({ email: PLAIN_EMAIL, hashedPassword: hashed });

    // Reload cache: repo.find returns entity with plaintext email (from() already applied)
    repo.find.mockResolvedValue([entity]);
    await service.reloadCache();

    repo.findOneBy.mockResolvedValue(entity);

    const result = await service.findUserByCredentials({ email: PLAIN_EMAIL, password: PASSWORD });
    expect(result.email).toBe(PLAIN_EMAIL);
  });

  it('throws invalid_credentials when email is not found in cache', async () => {
    await expect(
      service.findUserByCredentials({ email: 'wrong@example.com', password: PASSWORD }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws invalid_credentials when password is wrong', async () => {
    const hashed = await bcrypt.hash('correct-password', 10);
    const entity = makeUserEntity({ email: PLAIN_EMAIL, hashedPassword: hashed });
    repo.findOneBy.mockResolvedValue(entity);

    await expect(
      service.findUserByCredentials({ email: PLAIN_EMAIL, password: 'wrong-password' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws for a disabled user', async () => {
    const hashed = await bcrypt.hash(PASSWORD, 10);
    const entity = makeUserEntity({ email: PLAIN_EMAIL, hashedPassword: hashed, disabled: true });
    repo.findOneBy.mockResolvedValue(entity);

    await expect(
      service.findUserByCredentials({ email: PLAIN_EMAIL, password: PASSWORD }),
    ).rejects.toThrow(NotFoundException);
  });
});
