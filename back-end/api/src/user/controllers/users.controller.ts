import { Body, Controller, Get, Param, Patch, Post, Req, Res, } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dtos/create-user.dto';
import { Request, Response } from 'express';
import { Admin } from '../decorators/admin.decorator';
import { Public } from '../decorators/public.decorator';
import { AuthUtil } from '../services/auth.util';
import { LogInCredentialsDto } from '../dtos/login-credentials.dto';
import { ChangePasswordDto } from '../dtos/change-password.dto';
import { AuditService } from 'src/audit/audit.service';

@Controller('users')
export class UsersController {
    constructor(
        private readonly userService: UsersService,
        private readonly auditService: AuditService,
    ) { }

    @Admin()
    @Get()
    public getUsers() {
        return this.userService.findAll();
    }

    @Admin()
    @Get(':id')
    public getUser(@Param('id') id: number) {
        return this.userService.findOne(id);
    }

    @Admin()
    @Post('create')
    public create(@Body() createUserDto: CreateUserDto) {
        return this.userService.create(createUserDto);
    }

    @Admin()
    @Patch('update/:id')
    update(@Param('id') userId: number, @Body() createUserDto: CreateUserDto) {
        return this.userService.update(userId, createUserDto);
    }

    @Patch('change-password')
    public changePassword(
        @Req() request: Request,
        @Body() changedPassword: ChangePasswordDto) {
        const loggedInUser = AuthUtil.getLoggedInUser(request);
        // If logged in user is not admin, then change password for the user
        if (!loggedInUser.isSystemAdmin) {
            changedPassword.userId = loggedInUser.id;
        }
        return this.userService.changeUserPassword(changedPassword);
    }

    @Public()
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('login')
    public async login(
        @Req() request: Request,
        @Body() loginCredentials: LogInCredentialsDto) {
        const user = await this.userService.findUserByCredentials(loginCredentials);
        const loggedIn = AuthUtil.createNewSessionUser(request, user);
        this.auditService.log({
            userId: user.id,
            userEmail: user.email,
            action: 'LOGIN',
            resourceType: 'session',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
        });
        return loggedIn;
    }

    @Post('logout')
    public logout(@Req() req: Request, @Res() res: Response) {
        const sessionUser = AuthUtil.getSessionUser(req);
        if (sessionUser) {
            this.auditService.log({
                userId: sessionUser.id,
                userEmail: sessionUser.email,
                action: 'LOGOUT',
                resourceType: 'session',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
            });
        }
        req.session.destroy((err) => {
            if (err) {
                return res.status(500).send('Failed to destroy session.');
            }
            res.clearCookie('connect.sid'); // Clears the cookie storing the session ID
            return res.status(200).send(JSON.stringify({ message: 'success' }));
        });
    }

    // TODO. Do deleting of users. User should only be deleted when they have no records linked to them
    // Note also they should not have a history of changes as well.

}
