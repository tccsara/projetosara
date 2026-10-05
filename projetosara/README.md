# Cabeça D'Água - Protótipo Web

Este projeto é um protótipo inicial do sistema **Cabeça d'Água**, focado na parte web e na estrutura do backend em PHP + MySQL. O código da pasta `/arduino` foi adaptado para ESP32 e pode ser usado para envio real de dados do sensor para o backend.

## Estrutura do projeto

- `/backend`
  - `/api` - endpoints REST em PHP
  - `/config` - configuração de banco e JWT
  - `/controllers` - controladores MVC (futuro)
  - `/models` - acesso aos dados
  - `/middleware` - segurança e autenticação
- `/frontend`
  - `/assets/css` - estilos do painel
  - `/assets/js` - scripts da dashboard
  - `/pages` - páginas adicionais
- `/arduino`
  - `main.ino` - sketch do ESP32
  - `config.h` - configurações do ESP32
- `/database`
  - `schema.sql` - SQL para criação do banco de dados

## Instalação inicial

1. Crie o banco `cabeca_dagua` no HeidiSQL usando `database/schema.sql`.
2. Ajuste `backend/config/database.php` se necessário com usuário e senha do MySQL.
3. Acesse no navegador: `http://localhost/projetosara/frontend/index.html`.
4. Use a interface de demonstração para testar o dashboard sem a placa.

## Banco de dados

Importe `database/schema.sql` no HeidiSQL. Ele cria as tabelas:

- `users`
- `devices`
- `device_logs`
- `alerts`
- `telegram_settings`

## Protótipo ESP32

O sketch em `arduino/main.ino` foi adaptado para ESP32 e pode enviar leituras reais do sensor AJ-SR04M para a API local do projeto. Também há um modo de simulação para testes sem placa.

## Próximos passos

1. Implementar autenticação JWT completa no backend.
2. Criar tela de cadastro de usuário comum.
3. Adicionar envio real de alertas ao Telegram.
4. Conectar o frontend ao backend usando `axios`.
