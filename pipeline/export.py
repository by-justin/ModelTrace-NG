"""Write a bank dict as the binary FlatBuffers bank (schema/bank.fbs)."""

from __future__ import annotations

import flatbuffers
import numpy as np

from .mtfb import Bank, Block, Family, FamilyModel, Model


def _floats(builder: flatbuffers.Builder, values) -> int:
    return builder.CreateNumpyVector(np.asarray(values, dtype=np.float32).ravel())


def _strings(builder: flatbuffers.Builder, values: list[str], start) -> int:
    offsets = [builder.CreateString(v) for v in values]
    start(builder, len(offsets))
    for offset in reversed(offsets):
        builder.PrependUOffsetTRelative(offset)
    return builder.EndVector()


def _tables(builder: flatbuffers.Builder, offsets: list[int], start) -> int:
    start(builder, len(offsets))
    for offset in reversed(offsets):
        builder.PrependUOffsetTRelative(offset)
    return builder.EndVector()


def _block(builder: flatbuffers.Builder, block: dict) -> int:
    mean = np.asarray(block["mean"])
    basis = np.asarray(block["basis"]).reshape(-1, mean.size)
    env = np.asarray(block.get("env_centroids", []))
    vectors = {
        name: _floats(builder, value)
        for name, value in (
            ("mean", mean),
            ("scale", block["scale"]),
            ("basis", basis),
            ("centroids", block["centroids"]),
            ("env", env),
        )
    }
    Block.Start(builder)
    Block.AddDim(builder, mean.size)
    Block.AddRank(builder, basis.shape[0])
    Block.AddMean(builder, vectors["mean"])
    Block.AddScale(builder, vectors["scale"])
    Block.AddBasis(builder, vectors["basis"])
    Block.AddCentroids(builder, vectors["centroids"])
    Block.AddEnvCount(builder, env.shape[0] if env.ndim == 3 else 0)
    Block.AddEnvCentroids(builder, vectors["env"])
    return Block.End(builder)


def to_flatbuffer(bank: dict) -> bytes:
    builder = flatbuffers.Builder(1 << 20)
    family_index = {f["id"]: i for i, f in enumerate(bank["families"])}

    families = []
    for family in bank["families"]:
        fid, name = builder.CreateString(family["id"]), builder.CreateString(family["name"])
        Family.Start(builder)
        Family.AddId(builder, fid)
        Family.AddName(builder, name)
        families.append(Family.End(builder))

    models = []
    for model in bank["models"]:
        strings = {k: builder.CreateString(model[k]) for k in ("id", "display_name", "source", "collected")}
        members = _strings(builder, model["members"], Model.StartMembersVector)
        providers = _strings(builder, model["providers"], Model.StartProvidersVector)
        Model.Start(builder)
        Model.AddId(builder, strings["id"])
        Model.AddDisplayName(builder, strings["display_name"])
        Model.AddFamily(builder, family_index[model["family"]])
        Model.AddMembers(builder, members)
        Model.AddSource(builder, strings["source"])
        Model.AddProviders(builder, providers)
        Model.AddCollected(builder, strings["collected"])
        Model.AddResponses(builder, model["responses"])
        Model.AddAcc1(builder, model["acc1"])
        Model.AddAcc3(builder, model["acc3"])
        Model.AddFam3(builder, model["fam3"])
        Model.AddFam3Unseen(builder, model["fam3_unseen"])
        models.append(Model.End(builder))

    fm = bank["family_model"]
    fm_vectors = {k: _floats(builder, fm[k]) for k in ("mean", "scale", "coef", "intercept")}
    FamilyModel.Start(builder)
    FamilyModel.AddDim(builder, len(fm["mean"]))
    FamilyModel.AddMean(builder, fm_vectors["mean"])
    FamilyModel.AddScale(builder, fm_vectors["scale"])
    FamilyModel.AddCoef(builder, fm_vectors["coef"])
    FamilyModel.AddIntercept(builder, fm_vectors["intercept"])
    family_model = FamilyModel.End(builder)

    hellinger, ordered = _block(builder, bank["hellinger"]), _block(builder, bank["ordered"])
    families_vec = _tables(builder, families, Bank.StartFamiliesVector)
    models_vec = _tables(builder, models, Bank.StartModelsVector)
    beta, unknown = _floats(builder, bank["beta"]), _floats(builder, bank["unknown_threshold"])
    version, built_at = builder.CreateString(bank["version"]), builder.CreateString(bank["built_at"])

    Bank.Start(builder)
    Bank.AddVersion(builder, version)
    Bank.AddBuiltAt(builder, built_at)
    Bank.AddValueMax(builder, bank["value_max"])
    Bank.AddMinNumbers(builder, bank["min_numbers"])
    Bank.AddMinRatio(builder, bank["min_ratio"])
    Bank.AddAlpha(builder, bank["alpha"])
    Bank.AddOrderedWeight(builder, bank["ordered_weight"])
    Bank.AddFamilies(builder, families_vec)
    Bank.AddModels(builder, models_vec)
    Bank.AddHellinger(builder, hellinger)
    Bank.AddOrdered(builder, ordered)
    Bank.AddBeta(builder, beta)
    Bank.AddUnknownThreshold(builder, unknown)
    Bank.AddTierMatch(builder, bank["tier_match"])
    Bank.AddTierFamily(builder, bank["tier_family"])
    Bank.AddFamilyModel(builder, family_model)
    builder.Finish(Bank.End(builder), file_identifier=b"MTB2")
    return bytes(builder.Output())
