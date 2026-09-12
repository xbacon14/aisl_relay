# Guía de implementación de Alexa en AWS para Relay

Esta guía implementa el slice P2 del demo:

```text
Echo Dot / Alexa
        |
        | Alexa Skills Kit request
        v
AWS Lambda (apps/alexa)
        |
        | HTTPS + X-Relay-Key
        v
https://relay.utruck.com.py
        |
        v
PostgreSQL compartido con Telegram
```

No hace falta API Gateway. Alexa invoca la Lambda por su ARN y la Lambda llama a la API pública de Relay.

## 1. Estado y contrato que ya existen

Al 12 de septiembre de 2026 se verificó lo siguiente:

- `GET https://relay.utruck.com.py/api/health` responde `200` con `contractVersion: "1"` y `store: "postgres"`.
- `GET https://relay.utruck.com.py/api/tasks/next` sin credencial responde `401 UNAUTHORIZED`.
- El backend protege todas las rutas salvo `/api/health` cuando tiene configurado `RELAY_API_KEY`.
- La credencial se envía en el header HTTP `X-Relay-Key`.
- `packages/contract/src/client.ts` ya agrega ese header automáticamente cuando existe `RELAY_API_KEY`.
- `apps/alexa/src/local.ts` todavía es un stub; faltan los handlers de ASK y el entrypoint de Lambda.

Los archivos congelados `CONTRACT.md` y `packages/contract/src/index.ts` no necesitan cambios.

## 2. Cómo manejar y enviar el API key

La Lambda necesita exactamente estas variables de entorno:

```text
RELAY_API_URL=https://relay.utruck.com.py
RELAY_API_KEY=<el mismo valor configurado en el backend de producción>
```

El valor de `RELAY_API_URL` no debe terminar en `/api`: `RelayClient` agrega rutas como `/api/tasks/next`.

No se debe enviar el key en la URL, query string, body JSON, interaction model ni código fuente. El request correcto es:

```http
GET /api/tasks/next HTTP/1.1
Host: relay.utruck.com.py
Accept: application/json
X-Relay-Key: <RELAY_API_KEY>
```

En el código de Alexa no hace falta construir ese header a mano:

```ts
import { RelayClient } from "@relay/contract/client";

const relay = RelayClient.fromEnv();
const next = await relay.nextTask();
```

`RelayClient.fromEnv()` lee ambas variables y cada método manda `X-Relay-Key` automáticamente.

Para comprobar la credencial desde PowerShell sin escribirla en el comando:

```powershell
$relayKey = Read-Host -MaskInput "RELAY_API_KEY"
$headers = @{ "X-Relay-Key" = $relayKey }
Invoke-RestMethod `
  -Uri "https://relay.utruck.com.py/api/tasks/next" `
  -Headers $headers `
  -Method Get
Remove-Variable relayKey
```

El resultado esperado es `200`. Un `401` significa que el valor no coincide con el del backend o que no llegó el header.

Para el hackathon, guardar el key como variable de entorno de Lambda es el camino más corto. Lambda cifra sus variables en reposo con KMS. Para una etapa posterior se puede migrar a Secrets Manager; no conviene añadir esa integración antes de que el demo E2E funcione.

Si no se conoce el valor actual, se debe recuperarlo del entorno secreto usado por el despliegue del backend. No hay que crear un key diferente solo para Alexa: el backend acepta un único `RELAY_API_KEY`. Si se rota, se debe actualizar tanto el backend como Lambda y volver a probar inmediatamente.

## 3. Implementar el handler de Alexa

Crear `apps/alexa/src/lambda.ts` con el siguiente contenido. Los mensajes están en inglés porque el demo y el invocation name actual usan `en-US` y `my afternoon`.

```ts
import {
  getIntentName,
  getRequestType,
  SkillBuilders,
  type ErrorHandler,
  type HandlerInput,
  type RequestHandler,
} from "ask-sdk-core";
import { RelayApiError, RelayClient } from "@relay/contract/client";
import type { Task } from "@relay/contract";

const relay = RelayClient.fromEnv();
const retrySpeech = "I can't check right now. Let's try again in a moment.";
const reprompt = "You can say I'm done, what's next, or what's left.";

function escapeSpeech(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function taskSpeech(task: Task): string {
  const duration = task.durationMinutes
    ? `, about ${task.durationMinutes} minutes`
    : "";
  return `${escapeSpeech(task.title)}${duration}`;
}

function openResponse(handlerInput: HandlerInput, speech: string) {
  return handlerInput.responseBuilder
    .speak(speech)
    .reprompt(reprompt)
    .getResponse();
}

async function noPendingSpeech(): Promise<string> {
  const status = await relay.status();
  if (status.total === 0) {
    return "Nothing is planned yet. Ask a grown-up to add the afternoon.";
  }
  return "You're all done for today.";
}

const LaunchHandler: RequestHandler = {
  canHandle(handlerInput) {
    return getRequestType(handlerInput.requestEnvelope) === "LaunchRequest";
  },
  async handle(handlerInput) {
    const result = await relay.nextTask();
    if (!result.task) {
      return handlerInput.responseBuilder
        .speak(await noPendingSpeech())
        .getResponse();
    }

    const noun = result.remaining === 1 ? "thing" : "things";
    return openResponse(
      handlerInput,
      `You have ${result.remaining} ${noun} to do this afternoon. ` +
        `Let's start with ${taskSpeech(result.task)}.`,
    );
  },
};

const NextTaskHandler: RequestHandler = {
  canHandle(handlerInput) {
    return (
      getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      getIntentName(handlerInput.requestEnvelope) === "NextTaskIntent"
    );
  },
  async handle(handlerInput) {
    const result = await relay.nextTask();
    if (!result.task) {
      return handlerInput.responseBuilder
        .speak(await noPendingSpeech())
        .getResponse();
    }
    return openResponse(handlerInput, `Next, ${taskSpeech(result.task)}.`);
  },
};

const DoneHandler: RequestHandler = {
  canHandle(handlerInput) {
    return (
      getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      getIntentName(handlerInput.requestEnvelope) === "DoneIntent"
    );
  },
  async handle(handlerInput) {
    try {
      const result = await relay.completeNextTask();
      if (result.remaining === 0) {
        return handlerInput.responseBuilder
          .speak("Done. You're all done for today.")
          .getResponse();
      }
      if (!result.next) throw new Error("Backend returned remaining tasks without next");

      const noun = result.remaining === 1 ? "task" : "tasks";
      return openResponse(
        handlerInput,
        `Done. ${result.remaining} ${noun} left. Next, ${taskSpeech(result.next)}.`,
      );
    } catch (error) {
      if (error instanceof RelayApiError && error.code === "ROUTINE_EMPTY") {
        return handlerInput.responseBuilder
          .speak("Nothing is planned yet. Ask a grown-up to add the afternoon.")
          .getResponse();
      }
      if (error instanceof RelayApiError && error.code === "ROUTINE_COMPLETE") {
        return handlerInput.responseBuilder
          .speak("You're all done for today.")
          .getResponse();
      }
      throw error;
    }
  },
};

const WhatsLeftHandler: RequestHandler = {
  canHandle(handlerInput) {
    return (
      getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      getIntentName(handlerInput.requestEnvelope) === "WhatsLeftIntent"
    );
  },
  async handle(handlerInput) {
    const status = await relay.status();
    if (status.total === 0) {
      return handlerInput.responseBuilder
        .speak("Nothing is planned yet. Ask a grown-up to add the afternoon.")
        .getResponse();
    }
    if (status.allDone) {
      return handlerInput.responseBuilder
        .speak("You're all done for today.")
        .getResponse();
    }

    const tasks = status.pending.map(taskSpeech).join(", ");
    const noun = status.pendingCount === 1 ? "task" : "tasks";
    return openResponse(
      handlerInput,
      `You have ${status.pendingCount} ${noun} left: ${tasks}.`,
    );
  },
};

const HelpHandler: RequestHandler = {
  canHandle(handlerInput) {
    return (
      getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      ["AMAZON.HelpIntent", "AMAZON.FallbackIntent"].includes(
        getIntentName(handlerInput.requestEnvelope),
      )
    );
  },
  handle(handlerInput) {
    return openResponse(handlerInput, reprompt);
  },
};

const StopHandler: RequestHandler = {
  canHandle(handlerInput) {
    return (
      getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      ["AMAZON.StopIntent", "AMAZON.CancelIntent"].includes(
        getIntentName(handlerInput.requestEnvelope),
      )
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak("Goodbye.").getResponse();
  },
};

const SessionEndedHandler: RequestHandler = {
  canHandle(handlerInput) {
    return getRequestType(handlerInput.requestEnvelope) === "SessionEndedRequest";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandlerImpl: ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error("[relay alexa] request failed", {
      name: error.name,
      message: error.message,
    });
    return handlerInput.responseBuilder.speak(retrySpeech).getResponse();
  },
};

export const handler = SkillBuilders.custom()
  .addRequestHandlers(
    LaunchHandler,
    NextTaskHandler,
    DoneHandler,
    WhatsLeftHandler,
    HelpHandler,
    StopHandler,
    SessionEndedHandler,
  )
  .addErrorHandlers(ErrorHandlerImpl)
  .lambda();
```

Puntos importantes del handler:

- Cada respuesta sobre tareas proviene de la API; Lambda no mantiene una copia del estado.
- `DoneIntent` solo dice `Done` después de recibir un `2xx` de `completeNextTask()`.
- `ROUTINE_EMPTY` y `ROUTINE_COMPLETE` se comunican de forma distinta.
- Cualquier timeout, `401`, `500` o respuesta fuera de contrato cae en el mensaje visible de reintento.
- No se imprime el API key en CloudWatch.

## 4. Crear el interaction model

En [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask):

1. Elegir **Create Skill**.
2. Nombre: `Relay Afternoon`.
3. Locale: **English (US)** para coincidir con el Echo y los textos del demo.
4. Experience: **Other** y modelo **Custom**.
5. Hosting: **Provision your own**.
6. En **Build > JSON Editor**, pegar el siguiente modelo.
7. Elegir **Save Model** y luego **Build Model**.

```json
{
  "interactionModel": {
    "languageModel": {
      "invocationName": "my afternoon",
      "intents": [
        {
          "name": "NextTaskIntent",
          "slots": [],
          "samples": [
            "what's next",
            "what is next",
            "next task",
            "tell me the next task"
          ]
        },
        {
          "name": "DoneIntent",
          "slots": [],
          "samples": [
            "I'm done",
            "I am done",
            "I finished",
            "I am finished",
            "done",
            "finished"
          ]
        },
        {
          "name": "WhatsLeftIntent",
          "slots": [],
          "samples": [
            "what's left",
            "what is left",
            "what tasks are left",
            "how many tasks are left"
          ]
        },
        {
          "name": "AMAZON.HelpIntent",
          "samples": []
        },
        {
          "name": "AMAZON.CancelIntent",
          "samples": []
        },
        {
          "name": "AMAZON.StopIntent",
          "samples": []
        },
        {
          "name": "AMAZON.FallbackIntent",
          "samples": []
        }
      ],
      "types": []
    }
  }
}
```

No agregar la palabra `Alexa` ni `open my afternoon` a los samples: Alexa maneja la invocación y los samples representan lo que el usuario dice dentro de la skill.

Después de crear la skill, copiar su **Skill ID** (`amzn1.ask.skill...`). Se usará para limitar quién puede invocar la Lambda.

## 5. Compilar un ZIP para Lambda

Como el repositorio usa npm workspaces y `@relay/contract` es un paquete local, conviene generar un único archivo bundle. Desde la raíz del repo:

```powershell
npm install --save-dev esbuild
npm run build -w @relay/contract
npx esbuild apps/alexa/src/lambda.ts `
  --bundle `
  --platform=node `
  --target=node24 `
  --format=cjs `
  --outfile=apps/alexa/lambda/index.js
Compress-Archive `
  -LiteralPath apps/alexa/lambda/index.js `
  -DestinationPath apps/alexa/lambda/relay-alexa.zip `
  -Force
```

El ZIP debe contener `index.js` en su raíz. Al estar bundleado, no necesita `node_modules` dentro del ZIP.

Antes de subirlo, ejecutar la puerta de calidad del repo:

```powershell
npm run verify
```

## 6. Crear y configurar la Lambda en AWS

En AWS Console:

1. Abrir **Lambda > Create function > Author from scratch**.
2. Function name: `relay-alexa`.
3. Runtime: **Node.js 24.x**. No usar Node 26 preview para el demo.
4. Architecture: dejar `x86_64`.
5. Crear la función con un role básico de ejecución para que pueda escribir logs en CloudWatch.
6. En **Code > Upload from > .zip file**, subir `apps/alexa/lambda/relay-alexa.zip`.
7. En **Runtime settings**, configurar Handler como `index.handler`.
8. En **Configuration > General configuration**, usar 256 MB y timeout de 10 segundos. El cliente Relay aborta sus llamadas HTTP a los 5 segundos.
9. En **Configuration > Environment variables**, agregar:

   ```text
   RELAY_API_URL=https://relay.utruck.com.py
   RELAY_API_KEY=<mismo secreto del backend>
   ```

10. En **Add trigger**, elegir **Alexa Skills Kit**.
11. Activar **Skill ID verification** y pegar el Skill ID copiado antes.
12. Guardar y copiar el ARN completo de la Lambda.

La verificación por Skill ID es importante: evita que otra skill de Alexa invoque la función.

## 7. Vincular Lambda con la skill

Volver a Alexa Developer Console:

1. Abrir **Build > Custom > Endpoint**.
2. Elegir **AWS Lambda ARN**.
3. Pegar el ARN de `relay-alexa` en **Default Region**.
4. Guardar endpoints.

Para un skill configurado en Norteamérica, AWS recomienda normalmente `us-east-1`. Alexa permite otras regiones Lambda, pero para el demo conviene usar `us-east-1` salvo que una medición muestre que otra región reduce la latencia total hasta `relay.utruck.com.py`.

## 8. Prueba de aceptación

### Prueba en Developer Console

1. Ir a **Test**.
2. Cambiar el stage a **Development**.
3. Crear primero tareas reales desde Telegram.
4. Ejecutar en el simulador:

   ```text
   open my afternoon
   I'm done
   what's left
   ```

5. Confirmar en CloudWatch que las tres invocaciones terminaron sin error.
6. Confirmar desde Telegram que la tarea completada por Alexa aparece completada.

### Prueba en Echo Dot

El Echo debe estar registrado con la misma cuenta Amazon usada en Developer Console. En la app Alexa, abrir **Skills & Games > Your Skills > Dev**, habilitar `Relay Afternoon` y ejecutar:

```text
Alexa, open my afternoon
Alexa, tell my afternoon I'm done
Alexa, ask my afternoon what's left
```

Para la demo principal, también se puede mantener abierta la sesión:

```text
Alexa, open my afternoon
I'm done
What's left?
```

El slice está terminado solamente cuando el flujo real funciona dos veces seguidas:

```text
Telegram crea tareas
-> Alexa lee la primera
-> Alexa completa la primera
-> Telegram consulta y ve el estado actualizado
```

## 9. Diagnóstico rápido

| Síntoma | Comprobación | Acción |
| --- | --- | --- |
| Lambda devuelve `401` | Probar `/api/tasks/next` con el mismo key desde PowerShell | Corregir `RELAY_API_KEY` en Lambda; no cambiar el header |
| Lambda no puede conectar | Probar `/api/health` y revisar timeout/DNS en CloudWatch | Confirmar `RELAY_API_URL=https://relay.utruck.com.py` |
| Alexa dice que hay un problema | Buscar `[relay alexa] request failed` en CloudWatch | Corregir la causa; no reemplazar el error por una confirmación falsa |
| Alexa no ejecuta Lambda | Revisar Endpoint ARN y trigger Alexa Skills Kit | Volver a crear el trigger con el Skill ID correcto |
| Se ejecuta otro intent | Revisar Alexa Simulator y agregar solo utterances del flujo P2 | Rebuild Model y volver a probar |
| Funciona en simulador pero no en Echo | Revisar cuenta Amazon y locale del dispositivo | Habilitar la skill Dev con la misma cuenta y usar `en-US` |

## 10. Referencias oficiales

- [Amazon: Host a Custom Skill as an AWS Lambda Function](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-an-aws-lambda-function.html)
- [Amazon: ASK SDK for Node.js - Configuring Skill Instance](https://developer.amazon.com/en-US/docs/alexa/alexa-skills-kit-sdk-for-nodejs/construct-skill-instance.html)
- [Amazon: Test Skills in the Alexa Developer Console](https://developer.amazon.com/en-US/docs/alexa/devconsole/test-your-skill.html)
- [AWS: Deploy Node.js Lambda functions with ZIP archives](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html)
- [AWS: Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
- [AWS: Securing Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars-encryption.html)
