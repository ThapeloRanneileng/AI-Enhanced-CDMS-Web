import { Body, Controller, Get, Header, Param, ParseFilePipe, ParseIntPipe, Post, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import { AuthUtil } from 'src/user/services/auth.util';
import { Admin } from 'src/user/decorators/admin.decorator';
import { CreatePaperArchiveDto } from '../dtos/paper-archive.dto';
import { PaperArchiveService } from '../services/paper-archive.service';

@Controller('paper-archive')
export class PaperArchiveController {
    constructor(private paperArchiveService: PaperArchiveService) { }

    @Get()
    public findAll() {
        return this.paperArchiveService.findAll();
    }

    @Get(':id')
    public find(@Param('id', ParseIntPipe) id: number) {
        return this.paperArchiveService.find(id);
    }

    @Admin()
    @Post()
    @UseInterceptors(FileInterceptor('file'))
    public upload(
        @Req() request: Request,
        @UploadedFile(new ParseFilePipe({ fileIsRequired: true })) file: Express.Multer.File,
        @Body() dto: CreatePaperArchiveDto,
    ) {
        return this.paperArchiveService.create(file, dto, AuthUtil.getLoggedInUserId(request));
    }

    @Get(':id/file')
    @Header('Content-Disposition', 'inline')
    public async download(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
        const filePath = await this.paperArchiveService.getFilePath(id);
        return new StreamableFile(createReadStream(filePath), {
            disposition: `inline; filename="${path.basename(filePath)}"`,
        });
    }
}
