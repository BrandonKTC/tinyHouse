"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewerResolvers = void 0;
const crypto_1 = __importDefault(require("crypto"));
const lib_1 = require("../../../lib");
const cookieOptions = {
    httpOnly: true,
    sameSite: true,
    signed: true,
    secure: process.env.NODE_ENV === "development" ? false : true,
};
const logInViaGoogle = (code, token, db, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { user } = yield lib_1.Google.logIn(code);
    if (!user) {
        throw new Error("Google login error");
    }
    // Name/Photo/Email Lists
    const userNamesList = user.names && user.names.length ? user.names : null;
    const userPhotosList = user.photos && user.photos.length ? user.photos : null;
    const userEmailsList = user.emailAddresses && user.emailAddresses.length
        ? user.emailAddresses
        : null;
    // User Display Name
    const userName = userNamesList ? userNamesList[0].displayName : null;
    // User Id
    const userId = userNamesList &&
        userNamesList[0].metadata &&
        userNamesList[0].metadata.source
        ? userNamesList[0].metadata.source.id
        : null;
    // User Avatar
    const userAvatar = userPhotosList && userPhotosList[0].url ? userPhotosList[0].url : null;
    // User Email
    const userEmail = userEmailsList && userEmailsList[0].value ? userEmailsList[0].value : null;
    // We'll first attempt to check if this user already exists in our database.
    if (!userId || !userName || !userAvatar || !userEmail) {
        throw new Error("Google login error");
    }
    // If the user already exists, we'll update the user information in the database to the latest information we get from Google.
    const updateRes = yield db.users.findOneAndUpdate(
    // Mongo will select the first document where _id field matches the userId we've obtained from Google.
    { _id: userId }, {
        // Update the name, avatar, and contact fields of our document with the latest Google data.
        $set: {
            name: userName,
            avatar: userAvatar,
            contact: userEmail,
            token,
        },
    }, 
    // Means we want to return the updated document (not the original document) and assign the result to the updateRes constant.
    { returnDocument: "after" });
    let viewer = updateRes.value;
    if (!viewer) {
        // If we weren't able to find an already existing user, we'll want to insert and add a new user into our database.
        const insertRes = yield db.users.insertOne({
            _id: userId,
            token,
            name: userName,
            avatar: userAvatar,
            contact: userEmail,
            income: 0,
            bookings: [],
            listings: [],
        });
        viewer = yield db.users.findOne({ _id: insertRes.insertedId });
    }
    res.cookie("viewer", userId, Object.assign(Object.assign({}, cookieOptions), { maxAge: 365 * 24 * 60 * 60 * 1000 }));
    return viewer;
});
const logInViaCookie = (token, db, req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const updateRes = yield db.users.findOneAndUpdate({ _id: req.signedCookies.viewer }, { $set: { token } }, { returnDocument: "after" });
    let viewer = updateRes.value;
    if (!viewer) {
        res.clearCookie("viewer", cookieOptions);
    }
    return viewer;
});
exports.viewerResolvers = {
    Query: {
        authUrl: () => {
            try {
                return lib_1.Google.authUrl;
            }
            catch (err) {
                throw new Error(`Failed to query Google Auth Url: ${err}`);
            }
        },
    },
    Mutation: {
        logIn: (_root, { input }, { db, req, res }) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const code = input ? input.code : null;
                const token = crypto_1.default.randomBytes(16).toString("hex");
                const viewer = code
                    ? yield logInViaGoogle(code, token, db, res)
                    : yield logInViaCookie(token, db, req, res);
                if (!viewer) {
                    return { didRequest: true };
                }
                return {
                    _id: viewer._id,
                    token: viewer.token,
                    avatar: viewer.avatar,
                    walletId: viewer.walletId,
                    didRequest: true,
                };
            }
            catch (err) {
                throw new Error(`Failed to log in: ${err}`);
            }
        }),
        logOut: (_root, _args, { res }) => {
            try {
                res.clearCookie("viewer", cookieOptions);
                return { didRequest: true };
            }
            catch (error) {
                throw new Error(`Failed to log out: ${error}`);
            }
        },
        connectStripe: (_root, { input }, { db, req }) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const { code } = input;
                let viewer = yield (0, lib_1.authorize)(db, req);
                if (!viewer) {
                    throw new Error("Viewer cannot be found");
                }
                const wallet = yield lib_1.Stripe.connect(code);
                if (!wallet)
                    throw new Error("stripe grant Error");
                const updateRes = yield db.users.findOneAndUpdate({ _id: viewer._id }, { $set: { walletId: wallet.stripe_user_id } }, { returnDocument: "after" });
                if (!updateRes.value)
                    throw new Error("viewer could not be updated");
                viewer = updateRes.value;
                return {
                    _id: viewer._id,
                    token: viewer.token,
                    avatar: viewer.avatar,
                    walletId: viewer.walletId,
                    didRequest: true,
                };
            }
            catch (error) {
                throw new Error(`Failed to connect with Stripe: ${error}`);
            }
        }),
        disconnectStripe: (_root, _args, { db, req }) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                let viewer = yield (0, lib_1.authorize)(db, req);
                if (!viewer)
                    throw new Error("viewer cannor be found");
                if (viewer.walletId) {
                    const wallet = yield lib_1.Stripe.disconnect(viewer.walletId);
                    if (!wallet) {
                        throw new Error("stripe disconnect error");
                    }
                }
                const updateRes = yield db.users.findOneAndUpdate({ _id: viewer._id }, { $set: { walletId: undefined } }, { returnDocument: "after" });
                if (!updateRes.value)
                    throw new Error("viewer could not be updated");
                viewer = updateRes.value;
                return {
                    _id: viewer._id,
                    token: viewer.token,
                    avatar: viewer.avatar,
                    walletId: viewer.walletId,
                    didRequest: true,
                };
            }
            catch (error) {
                throw new Error(`Failed to disconnect with Stripe: ${error}`);
            }
        }),
    },
    Viewer: {
        id: (viewer) => {
            return viewer._id;
        },
        hasWallet: (viewer) => viewer.walletId ? true : undefined,
    },
};
