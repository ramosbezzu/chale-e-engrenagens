package lareira.fixes.mixin;

import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Create 6.0.10 (issue #10218): "Cannot read field x because mf.axis is null".
 *
 * separate() so grava o eixo de colisao quando a distancia entre os centros e diferente de zero.
 * Um item parado exatamente no centro de um bloco da contraption (o que as brocas soltam, por
 * exemplo) tem distancia zero nos tres eixos, nenhum eixo e gravado e collideMany() le null.
 * O crash se repete toda vez que o chunk carrega, e o mundo nao abre mais.
 */
@Mixin(targets = "com.simibubi.create.foundation.collision.ContinuousOBBCollider$ContinuousSeparationManifold", remap = false)
public abstract class EixoNuloMixin {
    @Shadow Vec3 axis;
    @Shadow Vec3 normalAxis;

    /** A causa: distancia zero vira um valor minusculo com sinal, e o item e empurrado para fora normalmente. */
    @ModifyVariable(method = "separate", at = @At("HEAD"), argsOnly = true, ordinal = 0)
    private double lareira$distanciaNuncaZero(double distancia) {
        return distancia == 0 ? Math.copySign(1.0E-9D, distancia) : distancia;
    }

    /** A rede de seguranca (ex.: posicao NaN): sem eixo, a resposta e nula em vez de derrubar o servidor. */
    @Inject(method = "reset", at = @At("TAIL"))
    private void lareira$eixoNuncaNulo(CallbackInfo ci) {
        this.axis = Vec3.ZERO;
        this.normalAxis = Vec3.ZERO;
    }
}
