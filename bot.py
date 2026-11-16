import os

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)

TOKEN = os.getenv("BOT_TOKEN", "9079841137:AAGFVzPLH2-3bgsYDu-yBL587CzbEXTQ1g4")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://glowup-telegram.onrender.com/index.html")
ADMIN_ID = int(os.getenv("ADMIN_ID", "8513244807"))
MIN_DONATE = 5

dp = Dispatcher()


def main_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Играть", web_app=WebAppInfo(url=WEBAPP_URL))],
            [InlineKeyboardButton(text="Пополнить звёзды", callback_data="donate_menu")],
        ]
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
                f"Минимальное пополнение — {MIN_DONATE} звёзд.",
                reply_markup=main_kb(),
            )
            return
        await message.answer(
            f"Пополнение на {amount} звёзд.\n"
            "Оплата пока не подключена: платёжный провайдер и зачисление "
            "на игровой баланс настраиваются на сервере.",
            reply_markup=main_kb(),
        )
        return

    await message.answer(
        "Это GlowUp — мини-игра в Telegram.\n\n"
        "Внутри: апгрейдер предметов, кейсы, колесо, мины, дартс, кости, "
        "напёрстки и рынок НФТ. Валюта — звёзды, их можно крутить и умножать.\n\n"
        "Жми «Играть», чтобы войти.",
        reply_markup=main_kb(),
    )


@dp.callback_query(F.data == "donate_menu")
async def on_donate(call: CallbackQuery) -> None:
    if call.from_user.id == ADMIN_ID:
        await call.message.answer(
            "Админ-доступ: звёзды выдаются прямо в игре — профиль → «Админ-баланс».",
        )
    await call.message.answer(
        f"Пополнение от {MIN_DONATE} звёзд. "
        "Зачисление на игровой баланс появится после подключения платежей.",
    )
    await call.answer()


async def main() -> None:
    bot = Bot(token=TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
    await dp.start_polling(bot)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
