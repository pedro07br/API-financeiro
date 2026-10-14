-- O módulo cria os próprios databases (financeiro, financeiro_test) na primeira execução.
GRANT ALL PRIVILEGES ON `financeiro`.* TO 'financeiro'@'%';
GRANT ALL PRIVILEGES ON `financeiro\_test`.* TO 'financeiro'@'%';
GRANT ALL PRIVILEGES ON `financeiro\_dev`.* TO 'financeiro'@'%';
