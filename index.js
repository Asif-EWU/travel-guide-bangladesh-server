const express = require('express')
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const imgbbUploader = require("imgbb-uploader");
const sharp = require('sharp');
const fileUpload = require('express-fileupload');
const fs = require('fs-extra');
const mongo = require('mongodb');
const MongoClient = require('mongodb').MongoClient;

require('dotenv').config();
const port = 5000;

const fileStorageEngine = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './images')
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '--' + file.originalname)
    }
});
const upload = multer({ storage: fileStorageEngine });

async function resizeImage(imagePath, resizePath, width, height) {
    await sharp(imagePath)
    .resize(width, height, {
        fit: 'fill'
    })
    .jpeg({
        chromaSubsampling: '4:2:0'
    })
    .withMetadata()
    .toFile(resizePath);
    
    return imgbbUploader(process.env.IMGBB_API, resizePath)
    .then((response) => {
        return (response.url);
    })
    .catch((error) => console.error(error));
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.efdix.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`;

const app = express();
app.use(cors());
app.use(bodyParser.json());
// app.use(fileUpload());

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
client.connect(err => {
    if(err) {
        console.log("Error --->", err);
        return;
    }
    console.log("MongoDB connected successfully");

    const groupCollection = client.db(process.env.DB_NAME).collection("group");
    const destinationCollection = client.db(process.env.DB_NAME).collection("destination");
    const userCollection = client.db(process.env.DB_NAME).collection("user");

    app.post('/checkUser', (req, res) => {
        const userEmail = req.body.email;
        const userName = req.body.name;
        const userPhoto = req.body.photo;

        userCollection.find({email: userEmail})
        .toArray((err, document) => {
            if(document.length)
                res.status(200).send(document[0]);
            else {
                const user = {
                    email: userEmail,
                    name: userName,
                    photo: userPhoto,
                    isAdmin: false,
                    liked_destinations: [],
                    liked_groups: [],
                    liked_guided: [],
                    bookmarks: []
                };

                userCollection.insertOne(user)
                    .then(result => {
                        console.log("User info inserted successfully.")
                        res.status(200).send(user);
                    });
            }
                // res.send({adminVerified: false});
        });
    });

    app.post('/updateBookmark', (req, res) => {
        userCollection.updateOne(
            { email: req.body.email },
            {
                $set: { bookmarks: req.body.bookmarks }
            }
        )
            .then(result => {
                console.log(result);
                console.log("Bookmarks updated successfully");
            });
    });

    app.post('/updateLikedDestination', (req, res) => {
        // update user collection
        userCollection.updateOne(
            { email: req.body.email },
            {
                $set: {liked_destinations: req.body.likedDestinations}
            }
        )
            .then(result => {
                console.log(result);
                console.log("Destination like updated successfully");
            });
        
        // update destination Collection  
        const destId = new mongo.ObjectID(req.body.destinationId);
        destinationCollection.updateOne(
            { '_id': destId },
            { 
                $inc: { like_count: req.body.likeIncrement }
            }
        )
            .then(result => {
                console.log(result);
                console.log("Like updated successfully");
            });
    });

    app.post('/updateLikedGroup', (req, res) => {
        console.log("YES");
        // update user collection
        userCollection.updateOne(
            { email: req.body.email },
            {
                $set: {liked_groups: req.body.likedGroups}
            }
        )
            .then(result => {
                console.log("Group like updated successfully");
            });
        
        // update group Collection  
        const groupId = new mongo.ObjectID(req.body.groupId);
        groupCollection.updateOne(
            { '_id': groupId },
            { 
                $inc: { like_count: req.body.likeIncrement }
            }
        )
            .then(result => {
                console.log("Like updated successfully");
            });
    });

    app.get('/groupList', (req, res) => {
        groupCollection.find({})
            .toArray((err, documents) => {
                res.status(200).send(documents);
            });
    });

    app.get('/destinationList', (req, res) => {
        destinationCollection.find({})
            .toArray((err, documents) => {
                res.status(200).send(documents);
            });
    });

    app.post('/addGroup', upload.single("logo"), (req, res) => {
        const group_name = req.body.group_name;
        const fb_url = req.body.fb_url;
        const group_description = req.body.group_description;
        const like_count = Number(req.body.like_count);
        const logo_image = req.file;

        const resizeLocation = logo_image.destination + "/" + Date.now() + "---" + logo_image.originalname;

        async function getLogo() {
            const logoURL = await resizeImage(logo_image.path, resizeLocation, 1000, 1000);
            return logoURL;
        }

        getLogo().then(logoURL => {
            groupCollection.insertOne({ group_name, fb_url, group_description, like_count, logoURL })
                .then(result => {
                    console.log("Data sent successfully !!");
                    res.send(result.insertedCount > 0);
                }) 
        });
    });

    app.post('/addDestination', upload.any("destinationImage"), (req, res) => {
        const destination_name = req.body.destination_name;
        const destination_district = req.body.destination_district;
        const destination_description = req.body.destination_description;
        const like_count = Number(req.body.like_count);
        const destinationImages = req.files;
        
        const getDestImage = async () => {
            const destImage = [];

            for(let i=0; i<destinationImages.length; i++) {
                const resizeLocation = destinationImages[i].destination + "/" + Date.now() + "---" + destinationImages[i].originalname;
                
                const imgURL = await resizeImage(destinationImages[i].path, resizeLocation, 1400, 800);
                destImage.push(imgURL);
            }

            return destImage;
        }

        getDestImage().then(images => {
            destinationCollection.insertOne({ destination_name, destination_district, destination_description, destination_comments: [], like_count, destImageURL: images })
            .then(result => {
                console.log("Destination data sent successfully !!");
                res.send(result.insertedCount > 0);
            });
        });
    });

    app.get('/destination/:destinationId', (req, res) => {
        const destinationId = req.params.destinationId;
        
        const dest_id = new mongo.ObjectID(destinationId);
        destinationCollection.find({'_id': dest_id})
            .toArray((err, documents) => {
                res.status(200).send(documents[0])
            });
    })

    app.post('/updateComment', (req, res) => {
        const destId = new mongo.ObjectId(req.body.destinationId);

        destinationCollection.updateOne(
            { '_id': destId },
            {
                $set: { destination_comments: req.body.comments }
            }
        )
            .then(result => {
                console.log(result);
                res.status(200).send(result.modifiedCount > 0);
            });
    });
});

app.listen(process.env.PORT || port, () => {
    console.log(`Server is listening to port ${port}`);
});


