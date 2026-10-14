import { HttpStatus, UnprocessableEntityException, ValidationError, ValidationPipe } from '@nestjs/common';

function achatar(erros: ValidationError[], pai = ''): { campo: string; mensagem: string }[] {
  return erros.flatMap((e) => {
    const campo = pai ? `${pai}.${e.property}` : e.property;
    const proprios = Object.values(e.constraints ?? {}).map((mensagem) => ({ campo, mensagem }));
    return [...proprios, ...achatar(e.children ?? [], campo)];
  });
}

/** Erros de validação retornam 422 com a lista de campos no array `errors`. */
export const validacaoPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: (erros) =>
    new UnprocessableEntityException({ message: 'Dados inválidos', errors: achatar(erros) }),
});
