"""Backend-only provider settings. No credentials in reprs, reports, or logs."""

import os
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation


DEFAULTS = {
    "groq": ("openai/gpt-oss-120b", "0.15", "0.60"),
    "gemini": ("gemini-3.5-flash-lite", "0.30", "2.50"),
    "ollama": ("llama3.1:8b", "0", "0"),
}


def money(value: str) -> int:
    """Convert dollars to integer nanodollars without floating-point drift."""
    try:
        amount = Decimal(value)
        if not amount.is_finite() or amount < 0:
            raise ValueError
        return int((amount * 1_000_000_000).to_integral_value(rounding="ROUND_CEILING"))
    except (InvalidOperation, ValueError):
        raise ValueError("Invalid nonnegative monetary setting") from None


@dataclass(frozen=True)
class Settings:
    provider: str
    model: str
    key: str = field(default="", repr=False)
    input_rate: int = 0  # nanodollars per token
    output_rate: int = 0
    max_output: int = 2048  # total output budget, including reasoning
    timeout: float = 60
    attempts: int = 2


def settings(provider: str | None = None) -> Settings:
    provider = (provider or os.environ.get("SUMMARY_PROVIDER", "groq")).lower()
    if provider not in DEFAULTS:
        raise ValueError("SUMMARY_PROVIDER must be groq, gemini, or ollama")
    default_model, input_price, output_price = DEFAULTS[provider]
    prefix = provider.upper()
    model = os.environ.get(prefix + "_MODEL", default_model)
    if not model or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._/:" for c in model):
        raise ValueError("Invalid model identifier")
    if model != default_model and provider != "ollama":
        # An unknown model must never silently inherit a cheaper rate card.
        if not all(os.environ.get(prefix + suffix) for suffix in ("_INPUT_USD_PER_MILLION", "_OUTPUT_USD_PER_MILLION")):
            raise ValueError("Custom hosted models require explicit input/output prices")
    input_rate = (money(os.environ.get(prefix + "_INPUT_USD_PER_MILLION", input_price)) + 999_999) // 1_000_000
    output_rate = (money(os.environ.get(prefix + "_OUTPUT_USD_PER_MILLION", output_price)) + 999_999) // 1_000_000
    if provider != "ollama" and (input_rate <= 0 or output_rate <= 0):
        raise ValueError("Hosted model prices must be positive, including on free tiers")
    max_output = int(os.environ.get(prefix + "_MAX_OUTPUT_TOKENS", "512" if provider == "ollama" else "2048"))
    timeout = float(os.environ.get("AI_TIMEOUT_SECONDS", "60"))
    attempts = int(os.environ.get("AI_MAX_ATTEMPTS", "2"))
    if not 128 <= max_output <= 8192 or not 1 <= timeout <= 180 or not 1 <= attempts <= 3:
        raise ValueError("AI limits out of range (tokens 128–8192, seconds 1–180, attempts 1–3)")
    return Settings(provider, model, os.environ.get(prefix + "_API_KEY", ""), input_rate, output_rate, max_output, timeout, attempts)


def allowance(scope: str) -> int:
    if scope not in ("summary", "evaluation"):
        raise ValueError("Unknown usage scope")
    name, default = ("AI_MONTHLY_BUDGET_USD", "5") if scope == "summary" else ("AI_EVAL_MONTHLY_BUDGET_USD", "1")
    return money(os.environ.get(name, default))


def main() -> None:
    """Launcher probe: validate dotenv/config without printing credentials."""
    from pathlib import Path
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    try:
        selected = settings()
        if selected.provider != "ollama" and not selected.key:
            raise ValueError("Configured provider API key is missing")
        allowance("summary")
        allowance("evaluation")
    except (ValueError, OverflowError):
        raise SystemExit("Invalid AI configuration; check provider, key, prices, and limits in backend/.env") from None
    print(selected.provider)


if __name__ == "__main__":
    main()
