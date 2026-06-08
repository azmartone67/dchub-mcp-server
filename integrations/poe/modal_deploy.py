"""
One-command Modal deploy for the DC Hub Poe bot (dchub_bot.py, same folder).

Setup (once):
    pip install modal
    modal token new                                   # auth Modal
    # Create a Server bot at https://poe.com/create_bot and copy its access key:
    modal secret create dchub-poe POE_ACCESS_KEY=psk_YOUR_KEY

Deploy (from this integrations/poe/ folder):
    modal deploy modal_deploy.py

Modal prints a public URL like  https://<you>--dchub-poe-bot-poe-app.modal.run
Paste that as your Poe bot's **Server URL** at poe.com, then "Sync settings".
Done — every Poe user can now chat with @DCHub.
"""
import modal

app = modal.App("dchub-poe-bot")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi-poe>=0.0.36", "requests")
    .add_local_python_source("dchub_bot")  # bundle the bot module into the image
)


@app.function(image=image, secrets=[modal.Secret.from_name("dchub-poe")])
@modal.asgi_app()
def poe_app():
    import os
    import fastapi_poe as fp
    from dchub_bot import DCHubBot
    return fp.make_app(DCHubBot(), access_key=os.environ["POE_ACCESS_KEY"])
