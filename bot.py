import asyncio
import os
import sqlite3
from datetime import datetime

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LabeledPrice,
    Message,
    PreCheckoutQuery,
    WebAppInfo,
)

TOKEN = os.getenv("BOT_TOKEN", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://glowup-telegram.onrender.com/index.html")
ADMIN_ID = int(os.getenv("ADMIN_ID", "8513244807"))
MIN_DONATE = 5
DB_PATH = os.getenv("DB_PATH", "glowup_bot.sqlite3")

dp = Dispatcher()


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS players ("
        "user_id INTEGER PRIMARY KEY, stars INTEGER NOT NULL DEFAULT 0, updated_at TEXT)"
    )
    return conn


def add_stars(user_id: int, amount: int) -> int:
    conn = db()
    with conn:
        conn.execute(
            "INSERT INTO players (user_id, stars, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET stars = stars + excluded.stars, "
            "updated_at = excluded.updated_at",
            (user_id, amount, datetime.utcnow().isoformat()),
        )
    cur = conn.execute("SELECT stars FROM players WHERE user_id = ?", (user_id,))
    total = cur.fetchone()[0]
    conn.close()
    return total


def get_stars(user_id: int) -> int:
    conn = db()
    cur = conn.execute("SELECT stars FROM players WHERE user_id = ?", (user_id,))
    row = cur.fetchone()
    conn.close()
    return row[0] if row else 0


def main_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Играть", web_app=WebAppInfo(url=WEBAPP_URL))],
            [
                InlineKeyboardButton(text="Купить 5 ⭐", callback_data="buy_5"),
                InlineKeyboardButton(text="Купить 50 ⭐", callback_data="buy_50"),
            ],
            [
                InlineKeyboardButton(text="Купить 100 ⭐", callback_data="buy_100"),
                InlineKeyboardButton(text="Мой баланс", callback_data="balance"),
            ],
        ]
    )


GREETING = (
    "Привет! Это GlowUp — мини-игра в Telegram.\n\n"
    "Внутри: апгрейдер, кейсы, колесо, мины, дартс, кости, напёрстки, "
    "НФТ-модели и магазин событий. Валюта — звёзды.\n\n"
    "Жми «Играть», чтобы зайти. Звёзды можно докупить прямо здесь — "
    "они придут на игровой баланс."
)


@dp.message(CommandStart())
async def on_start(message: Message) -> None:
    payload = (message.text or "").split(maxsplit=1)
    arg = payload[1].strip() if len(payload) > 1 else ""

    if arg.startswith("donate_"):
        try:
            amount = int(arg.split("_", 1)[1])
        except ValueError:
            amount = 0
        if amount < MIN_DONATE:
            await message.answer(
                f"Минимальное пополнение — {MIN_DONATE} звёзд.", reply_markup=main_kb()
            )
            return
        await send_stars_invoice(message.chat.id, amount)
        return

    await message.answer(GREETING, reply_markup=main_kb())


@dp.message(Command("balance"))
async def on_balance(message: Message) -> None:
    await message.answer(
        f"Баланс: {get_stars(message.from_user.id)} ⭐\n"
        f"Купить звёзды можно кнопками ниже.",
        reply_markup=main_kb(),
    )


async def send_stars_invoice(chat_id: int, amount: int) -> None:
    await dp.bot.send_invoice(
        chat_id=chat_id,
        title=f"Пополнение на {amount} звёзд",
        description=f"{amount} звёзд на игровой баланс GlowUp",
        payload=f"stars:{amount}",
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(label="Звёзды", amount=amount)],
    )


@dp.callback_query(F.data.startswith("buy_"))
async def on_buy(call: CallbackQuery) -> None:
    amount = int(call.data.split("_", 1)[1])
    if amount < MIN_DONATE:
        await call.answer(f"Минимум {MIN_DONATE} звёзд", show_alert=True)
        return
    await call.answer()
    await send_stars_invoice(call.message.chat.id, amount)


@dp.callback_query(F.data == "balance")
async def on_balance_btn(call: CallbackQuery) -> None:
    await call.answer(f"Баланс: {get_stars(call.from_user.id)} ⭐", show_alert=True)


@dp.pre_checkout_query()
async def on_pre_checkout(query: PreCheckoutQuery) -> None:
    await query.answer(ok=True)


@dp.message(F.successful_payment)
async def on_paid(message: Message) -> None:
    payment = message.successful_payment
    amount = payment.total_amount
    total = add_stars(message.from_user.id, amount)
    await message.answer(
        f"Оплата прошла: +{amount} ⭐\nБаланс в боте: {total} ⭐\n\n"
        "Открой игру кнопкой ниже — звёзды подтянутся.",
        reply_markup=main_kb(),
    )


async def main() -> None:
    if not TOKEN:
        raise SystemExit("Не задан BOT_TOKEN")
    bot = Bot(token=TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
    dp.bot = bot
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
