import fs from 'node:fs/promises';   // лише проміс-версія модуля fs
import path from 'node:path';
import { Command } from 'commander';
import http from 'node:http';
import { once } from 'node:events';   // перетворює подію на проміс
import superagent from 'superagent';

const SOURCE_URL = 'https://http.cat';

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

//    Допоміжні функції 

// Надіслати текстову відповідь (для помилок і повідомлень)
function sendText(res, statusCode, message, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...extraHeaders,
  });
  res.end(message);
}

// Шлях до файлу картинки в кеші: <тека кешу>/<код>.jpg
function getCacheFile(code) {
  return path.join(cacheDir, `${code}.jpg`);
}

// Надіслати картинку. source — звідки взято картинку: 'cache' або 'http.cat'
function sendImage(res, image, source) {
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'X-Image-Source': source,   // наш додатковий заголовок
  });
  res.end(image);
}

// Отримати картинку з http.cat.
// Повертає Buffer з картинкою або null, якщо отримати не вдалося.
async function fetchFromHttpCat(code) {
  try {
    // responseType('blob') — тіло відповіді прийде як Buffer (двійкові дані)
    const response = await superagent
      .get(`${SOURCE_URL}/${code}`)
      .responseType('blob');
    return response.body;
  } catch (err) {
    // superagent відхиляє проміс, якщо статус 4xx/5xx (err.status)
    // або якщо сталася мережева помилка (тоді err.status немає)
    console.log(`http.cat: не вдалося отримати ${code} (${err.status ?? err.message})`);
    return null;
  }
}

// Отримати все тіло запиту як Buffer.
// req — це потік (stream). Через for await читаємо його частинами (chunk)
// без колбеків, а потім склеюємо всі частини в один Buffer.
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

//      Обробники методів 
// GET: віддаємо з кешу, а якщо там немає — беремо з http.cat
async function handleGet(code, res) {
  const file = getCacheFile(code);

  // 1) Пробуємо прочитати картинку з кешу
  try {
    const image = await fs.readFile(file);
    console.log(`GET /${code} — з кешу`);
    sendImage(res, image, 'cache');
    return;
  } catch (err) {
    // ENOENT = файлу немає — це не помилка, просто йдемо на http.cat
    if (err.code !== 'ENOENT') throw err;
  }

  // 2) У кеші немає — запитуємо http.cat
  const image = await fetchFromHttpCat(code);
  if (image === null) {
    sendText(res, 404, `Картинку для коду ${code} не знайдено`);
    return;
  }

  // 3) Спочатку зберігаємо в кеш, потім відправляємо клієнту
  await fs.writeFile(file, image);
  console.log(`GET /${code} — з http.cat, збережено в кеш`);
  sendImage(res, image, 'http.cat');
}

// PUT: записуємо картинку з тіла запиту в кеш (або замінюємо наявну)
async function handlePut(code, req, res) {
  const body = await readBody(req);

  if (body.length === 0) {
    sendText(res, 400, 'Тіло запиту порожнє — надішліть картинку');
    return;
  }

  await fs.writeFile(getCacheFile(code), body);
  console.log(`PUT /${code} — збережено ${body.length} байт`);
  sendText(res, 201, `Картинку для коду ${code} збережено в кеш`);
}

//          Сервер 

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

    if (req.method === 'GET') {
      await handleGet(code, res);
    } else if (req.method === 'PUT') {
      await handlePut(code, req, res);
    } else {
      sendText(res, 501, `Метод ${req.method} ще не реалізовано`);
    }

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