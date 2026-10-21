import type { JsonValue } from "@ora-space/plugin-sdk";

/** The one model a platform-model execution may use, as OpenCode's ACP selector names it. */
export interface FrozenModel {
  /** OpenCode's `<provider>/<model>` reference, e.g. `ora-model/vendor/model`. */
  readonly id: string;
  readonly name: string;
}

/** What the bridge does with one frame Ora sent towards the CLI. */
export type InboundDecision =
  /** Write this frame into the CLI. */
  | { readonly forward: JsonValue }
  /** Answer Ora with this frame instead; the CLI never sees the request. */
  | { readonly reply: JsonValue }
  /** A notification nobody may send in this execution; there is nothing to answer. */
  | { readonly drop: true };

/** JSON-RPC "method not found": these methods do not exist for a frozen execution. */
const METHOD_NOT_AVAILABLE = -32601;
/** JSON-RPC "invalid params": a model other than the frozen one was asked for. */
const MODEL_FROZEN = -32602;

/**
 * Methods that could hand the CLI another upstream, another credential, or none at all.
 *
 * OpenCode 2.0.32 answers `authenticate` as a no-op and serves none of the others, but ACP
 * defines them (`providers/set` reroutes an agent, `logout` drops its login), and a later CLI pin
 * that starts serving one must not quietly become a way around the frozen provider.
 */
function isRouteMutation(method: string): boolean {
  return method === "authenticate" || method === "logout" ||
    method.startsWith("auth/") || method.startsWith("_auth/") ||
    method.startsWith("providers/");
}

/**
 * Keeps one platform-model execution on its frozen provider and model.
 *
 * The provider itself is fixed by the configuration `model-route.ts` hands the CLI; this class
 * only keeps a client from asking the CLI to leave it over ACP.
 */
export class ModelGuard {
  readonly #model: FrozenModel;

  constructor(model: FrozenModel) {
    this.#model = model;
  }

  /** Decides what happens to one frame Ora sent towards the CLI. */
  inbound(frame: JsonValue): InboundDecision {
    if (!isObject(frame) || typeof frame.method !== "string") {
      return { forward: frame };
    }
    const method = frame.method;
    const params = isObject(frame.params) ? frame.params : {};
    if (isRouteMutation(method)) {
      return refuse(
        frame,
        METHOD_NOT_AVAILABLE,
        `${method} is not available: this execution's model route is fixed`,
      );
    }
    const requested = method === "session/set_model"
      ? params.modelId
      : method === "session/set_config_option" && params.configId === "model"
      ? params.value
      : undefined;
    if (requested !== undefined && !this.#isFrozen(requested)) {
      return refuse(
        frame,
        MODEL_FROZEN,
        `this execution is fixed to the model ${this.#model.id}`,
      );
    }
    return { forward: frame };
  }

  /**
   * Accepts the frozen reference itself, and the same reference with an effort variant appended
   * (`<provider>/<model>/<variant>`), which OpenCode's selector also understands; neither changes
   * the model.
   */
  #isFrozen(value: JsonValue): boolean {
    return typeof value === "string" &&
      (value === this.#model.id || value.startsWith(`${this.#model.id}/`));
  }
}

function refuse(
  frame: { [key: string]: JsonValue },
  code: number,
  message: string,
): InboundDecision {
  return typeof frame.id === "string" || typeof frame.id === "number"
    ? { reply: { jsonrpc: "2.0", id: frame.id, error: { code, message } } }
    : { drop: true };
}

function isObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
