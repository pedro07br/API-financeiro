import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { validacaoPipe } from './common/http/validacao.pipe';

export const PREFIXO = 'api/financeiro';

/** Configuração compartilhada entre o servidor (main.ts) e os testes e2e. */
export function configurarApp(app: INestApplication) {
  app.setGlobalPrefix(PREFIXO);
  app.useGlobalPipes(validacaoPipe);
  app.enableShutdownHooks();
  const doc = new DocumentBuilder()
    .setTitle('API do Módulo Financeiro')
    .setDescription(
      'Contas a receber/pagar, cobranças, recorrências, inadimplência e conciliação bancária. ' +
        'Autenticação JWT RS256 emitido pelo módulo de Autenticação; tenant extraído do token. ' +
        'Respostas no formato { success, data, message, errors }.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(`${PREFIXO}/docs`, app, SwaggerModule.createDocument(app, doc));
  return app;
}
