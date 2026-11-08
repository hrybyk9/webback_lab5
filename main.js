import fs from 'node:fs/promises';   // лише проміс-версія модуля fs
import path from 'node:path';
import { Command } from 'commander';
import http from 'node:http';
import { once } from 'node:events';   // перетворює подію на проміс

// Параметри командного рядка
const program = new Command();

program
  // -h зайнята під --host, тому довідку залишаємо лише як --help
  .helpOption('--help', 'показати довідку')
  // requiredOption: якщо опції немає — commander сам виводить помилку
  // і завершує програму з ненульовим кодом
  .requiredOption('-h, --host <address>', 'адреса сервера')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до теки з кешем');

program.parse();
const options = program.opts();

// Перетворюємо порт на число і перевіряємо, що він коректний
const port = Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Помилка: порт має бути цілим числом від 1 до 65535');
  process.exit(1);
}

// Повний (абсолютний) шлях до теки кешу
const cacheDir = path.resolve(options.cache);

//  Створення теки кешу 
// recursive: true — створює всі проміжні теки і НЕ дає помилки,
// якщо тека вже існує. await гарантує, що тека з'явиться
// ДО того, як сервер почне приймати запити.
try {
  await fs.mkdir(cacheDir, { recursive: true });
} catch (err) {
  console.error(`Не вдалося створити теку кешу: ${err.message}`);
  process.exit(1);
}

// Допоміжні функції 

// Надіслати текстову відповідь (для помилок і повідомлень)
function sendText(res, statusCode, message, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...extraHeaders,
  });
  res.end(message);
}

// Обробники методів 


// Сервер 

// Єдиний дозволений колбек — async-обробник запиту
const server = http.createServer(async (req, res) => {
  try {
    // Дозволені лише GET, PUT, DELETE. Для інших — 405
    // і заголовок Allow зі списком дозволених методів
    if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
      sendText(res, 405, `Метод ${req.method} не дозволений`, {
        Allow: 'GET, PUT, DELETE',
      });
      return;
    }

    // Перевірка шляху: рівно три цифри після "/", напр. /200, /418
    // (так ніхто не зможе передати щось на кшталт /../main.js)
    const match = req.url.match(/^\/(\d{3})$/);
    if (!match) {
      sendText(res, 400, 'Неправильний шлях. Приклад правильного: /200');
      return;
    }
    const code = match[1];

    sendText(res, 501, `Метод ${req.method} ще не реалізовано`);
  } catch (err) {
    // Будь-яка неочікувана помилка: відповідаємо 500, сервер працює далі
    console.error('Помилка сервера:', err);
    if (!res.headersSent) {
      sendText(res, 500, 'Внутрішня помилка сервера');
    } else {
      res.end();
    }
  }
});

// Значення --host і --port передаємо в listen()
server.listen(port, options.host);

// once() повертає проміс, який виконується при події 'listening'
// і відхиляється при події 'error' (напр., порт уже зайнятий)
try {
  await once(server, 'listening');
  console.log(`Сервер запущено: http://${options.host}:${port}`);
  console.log(`Тека кешу: ${cacheDir}`);
} catch (err) {
  console.error(`Не вдалося запустити сервер: ${err.message}`);
  process.exit(1);
}