var express = require('express');
var router = express.Router();
let mongoose = require('mongoose');
let { checkLogin } = require('../utils/authHandler.js');
let reservationModel = require('../schemas/reservations');
let cartModel = require('../schemas/cart');
let inventoryModel = require('../schemas/inventories');
let productModel = require('../schemas/products');

// get all cua user -> get reservations/
router.get('/', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservations = await reservationModel.find({ user: userId });
        res.status(200).send(reservations);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// get 1 cua user -> get reservations/:id
router.get('/:id', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservationId = req.params.id;
        let reservation = await reservationModel.findOne({ _id: reservationId, user: userId });
        if (!reservation) {
            return res.status(404).send({ message: "Reservation not found" });
        }
        res.status(200).send(reservation);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// reserveACart -> post reserveACart/
router.post('/reserveACart', checkLogin, async function (req, res, next) {
    let userId = req.userId;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let currentCart = await cartModel.findOne({ user: userId }).session(session);
        if (!currentCart || currentCart.items.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send({ message: "Cart is empty" });
        }

        let reservationItems = [];
        let totalAmount = 0;

        for (let item of currentCart.items) {
            let product = await productModel.findById(item.product).session(session);
            if (!product) {
                throw new Error(`Product ${item.product} not found`);
            }

            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (!inventory) {
                throw new Error(`Inventory for product ${item.product} not found`);
            }

            let availableStock = inventory.stock - inventory.reserved;
            if (availableStock < item.quantity) {
                throw new Error(`Not enough stock for product ${product.title}`);
            }

            // Update inventory
            inventory.reserved += item.quantity;
            await inventory.save({ session });

            let price = product.price;
            let subtotal = price * item.quantity;
            totalAmount += subtotal;

            reservationItems.push({
                product: item.product,
                quantity: item.quantity,
                price: price,
                subtotal: subtotal
            });
        }

        // Create reservation
        let newReservation = new reservationModel({
            user: userId,
            items: reservationItems,
            totalAmount: totalAmount,
            status: "actived",
            ExpiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours expiry
        });
        await newReservation.save({ session });

        // Clear cart
        currentCart.items = [];
        await currentCart.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.status(200).send(newReservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: error.message });
    }
});

// reserveItems -> post reserveItems/ {body gồm list product va quantity}
router.post('/reserveItems', checkLogin, async function (req, res, next) {
    let userId = req.userId;
    let { items } = req.body; // Array of { product, quantity }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).send({ message: "Items are required" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let reservationItems = [];
        let totalAmount = 0;

        for (let item of items) {
            if (!item.product || !item.quantity || item.quantity <= 0) {
                 throw new Error(`Invalid item format`);
            }
            let product = await productModel.findById(item.product).session(session);
            if (!product) {
                throw new Error(`Product ${item.product} not found`);
            }

            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (!inventory) {
                throw new Error(`Inventory for product ${item.product} not found`);
            }

            let availableStock = inventory.stock - inventory.reserved;
            if (availableStock < item.quantity) {
                throw new Error(`Not enough stock for product ${product.title}`);
            }

            // Update inventory
            inventory.reserved += item.quantity;
            await inventory.save({ session });

            let price = product.price;
            let subtotal = price * item.quantity;
            totalAmount += subtotal;

            reservationItems.push({
                product: item.product,
                quantity: item.quantity,
                price: price,
                subtotal: subtotal
            });
        }

        // Create reservation
        let newReservation = new reservationModel({
            user: userId,
            items: reservationItems,
            totalAmount: totalAmount,
            status: "actived",
            ExpiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours expiry
        });
        await newReservation.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.status(200).send(newReservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: error.message });
    }
});

// cancelReserve -> post cancelReserve/:id
router.post('/cancelReserve/:id', checkLogin, async function (req, res, next) {
    let userId = req.userId;
    let reservationId = req.params.id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let reservation = await reservationModel.findOne({ _id: reservationId, user: userId }).session(session);
        if (!reservation) {
            throw new Error("Reservation not found");
        }

        if (reservation.status !== "actived") {
            throw new Error(`Cannot cancel reservation with status ${reservation.status}`);
        }

        // Return stock
        for (let item of reservation.items) {
            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (inventory) {
                if (inventory.reserved >= item.quantity) {
                    inventory.reserved -= item.quantity;
                } else {
                    inventory.reserved = 0;
                }
                await inventory.save({ session });
            }
        }

        reservation.status = "cancelled";
        await reservation.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.status(200).send(reservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: error.message });
    }
});

module.exports = router;
