import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { RespostaPadrao } from './resposta';

@Catch()
export class ExcecaoFilter implements ExceptionFilter {
  private readonly logger = new Logger('Financeiro');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro interno';
    let errors: RespostaPadrao['errors'] = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body: any = exception.getResponse();
      if (typeof body === 'string') message = body;
      else {
        message = body.message && typeof body.message === 'string' ? body.message : exception.message;
        if (Array.isArray(body.errors)) errors = body.errors;
        else if (Array.isArray(body.message)) {
          message = 'Dados inválidos';
          errors = body.message.map((m: string) => ({ mensagem: m }));
        }
      }
    } else if (exception instanceof QueryFailedError && (exception as any).code === '23505') {
      status = HttpStatus.CONFLICT;
      message = 'Registro duplicado';
    } else if (exception instanceof QueryFailedError && (exception as any).code === '22P02') {
      status = HttpStatus.BAD_REQUEST;
      message = 'Identificador em formato inválido';
    } else {
      this.logger.error(exception);
    }

    const corpo: RespostaPadrao = { success: false, data: null, message, errors };
    res.status(status).json(corpo);
  }
}
